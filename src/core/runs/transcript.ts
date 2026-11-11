// What an agent did in one session, as a short account built from the lines its CLI printed, in the
// shapes Claude Code (`stream-json`) and Codex (`exec --json`) print. Pure: the page and the tests
// share it. Everything in those lines is the agent's text: each line of it is cleaned of what could
// reorder or hide text, and cut. A line that is not understood is shown as it is, never dropped.
import { oneLine } from "../text.ts";

export interface Out {
  /** The first lines of what a call returned. */
  lines: string[];
  /** How many more there were. */
  more: number;
  error: boolean;
}
export type Step =
  | { kind: "said"; text: string }
  | { kind: "call"; tool: string; arg: string; out?: Out }
  | { kind: "end"; text: string; tokens?: number; usd?: number; error: boolean }
  | { kind: "plain"; text: string };
export interface Account {
  steps: Step[];
  /** Hook, system and bookkeeping events left out. */
  quiet: number;
  /** Steps past the limit, not shown. */
  hidden: number;
}

const MOST_STEPS = 500;
const SAID = 2000;
const LINE = 300;
const OUT_LINES = 40;
const MAX_LINE = 200_000;

type Loose = Record<string, unknown>;
const object = (v: unknown): Loose | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Loose) : undefined;
const text = (v: unknown) => (typeof v === "string" ? v : "");
const number = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const firstText = (v: unknown) =>
  Object.values(object(v) ?? {}).find((x) => typeof x === "string" && x) as string | undefined;

/** A paragraph of the agent's words: its lines each cleaned, the whole bounded. */
function said(whole: string): string {
  const cut = whole.length > SAID;
  const lines = whole
    .slice(0, SAID)
    .split("\n")
    .map((l) => oneLine(l, SAID));
  return `${lines.join("\n").trim()}${cut ? "..." : ""}`;
}

/** The first line of a call's main argument. */
const arg = (v: unknown) => oneLine(text(v).split("\n")[0] ?? "", LINE);

function out(content: unknown, error: boolean): Out {
  const parts = Array.isArray(content) ? content.map((p) => text(object(p)?.text)) : [text(content)];
  // the host wraps a refused tool call in its own tags: they are not the agent's words
  const lines = parts
    .join("\n")
    .replace(/<\/?tool_use_error>/g, "")
    .split("\n");
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
  return {
    lines: lines.slice(0, OUT_LINES).map((l) => oneLine(l, LINE)),
    more: Math.max(0, lines.length - OUT_LINES),
    error,
  };
}

const MAIN: Record<string, string> = {
  Bash: "command",
  Read: "file_path",
  Write: "file_path",
  Edit: "file_path",
  NotebookEdit: "notebook_path",
  Glob: "pattern",
  Grep: "pattern",
};
/** `mcp__factor__handoff_write` as "factor: handoff_write". */
const toolName = (name: string) => (name.startsWith("mcp__") ? name.slice(5).replace("__", ": ") : name);

export function account(transcript: string, most = MOST_STEPS): Account {
  const steps: Step[] = [];
  let quiet = 0;
  const waiting = new Map<string, Extract<Step, { kind: "call" }>>();
  const plain = (line: string) => steps.push({ kind: "plain", text: oneLine(line, LINE) });

  const claude = (event: Loose, line: string) => {
    const content = object(event.message)?.content;
    for (const part of Array.isArray(content) ? content : []) {
      const block = object(part);
      const kind = text(block?.type);
      if (!block) plain(line);
      else if (kind === "text" && event.type === "assistant") {
        const words = said(text(block.text));
        if (words) steps.push({ kind: "said", text: words });
      } else if (kind === "tool_use") {
        const name = text(block.name);
        const input = object(block.input);
        const call = {
          kind: "call" as const,
          tool: toolName(name),
          arg: arg(input?.[MAIN[name] ?? ""] ?? firstText(input)),
        };
        waiting.set(text(block.id), call);
        steps.push(call);
      } else if (kind === "tool_result") {
        const call = waiting.get(text(block.tool_use_id));
        if (call) call.out = out(block.content, block.is_error === true);
        else
          steps.push({
            kind: "plain",
            text: oneLine(`A result with no call: ${out(block.content, false).lines[0] ?? ""}`, LINE),
          });
      } else if (kind === "thinking" || kind === "redacted_thinking" || event.type === "user") quiet++;
      else plain(line);
    }
    if (!Array.isArray(content) && event.type === "user") quiet++; // the prompt, sent back as it was
  };

  const codex = (event: Loose, line: string) => {
    const item = object(event.item);
    const kind = text(item?.type);
    if (event.type === "item.started" || kind === "reasoning") quiet++;
    else if (kind === "agent_message") steps.push({ kind: "said", text: said(text(item?.text)) });
    else if (kind === "command_execution") {
      const whole = text(item?.command);
      const match = /^\S*(?:zsh|bash|sh) -lc (['"])([\s\S]*)\1$/.exec(whole);
      const inner = match
        ? match[1] === '"'
          ? (match[2] ?? "").replaceAll('\\"', '"')
          : (match[2] ?? "")
        : whole;
      const failed = item?.status === "failed" || number(item?.exit_code) !== 0;
      steps.push({ kind: "call", tool: "shell", arg: arg(inner), out: out(item?.aggregated_output, failed) });
    } else if (kind === "mcp_tool_call") {
      const result = object(item?.result);
      steps.push({
        kind: "call",
        tool: `${text(item?.server)}: ${text(item?.tool)}`,
        arg: arg(firstText(item?.arguments)),
        ...(result || item?.error
          ? {
              out: out(
                result?.content ?? object(item?.error)?.message,
                !!item?.error || item?.status === "failed",
              ),
            }
          : {}),
      });
    } else if (kind === "file_change") {
      const files = Array.isArray(item?.changes)
        ? item.changes.map((c) => text(object(c)?.path)).filter(Boolean)
        : [];
      steps.push({ kind: "call", tool: "edit", arg: arg(files.join(", ")) });
    } else plain(line);
  };

  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;
    if (line.length > MAX_LINE) {
      plain(line); // not read: a line this long is not an event worth the time
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      plain(line); // cut in the middle, or not JSON
      continue;
    }
    const event = object(parsed);
    const type = text(event?.type);
    if (!event) plain(line);
    else if (type === "factor.cut") {
      // the host kept only the end of a session that passed its cap
      const [kept, size] = [number(event.kept), number(event.bytes)];
      steps.push({
        kind: "plain",
        text: `Only the last ${kept} of ${size} bytes of this session were kept.`,
      });
    } else if (type === "assistant" || type === "user") claude(event, line);
    else if (type === "item.started" || type === "item.completed") codex(event, line);
    else if (["system", "rate_limit_event", "tool_progress", "thread.started", "turn.started"].includes(type))
      quiet++;
    else if (type === "result" || type === "turn.completed" || type === "turn.failed" || type === "error") {
      const usage = object(event.usage);
      const bad =
        type === "turn.failed" ||
        type === "error" ||
        (type === "result" && (event.subtype !== "success" || event.is_error === true));
      const used =
        type === "turn.completed"
          ? number(usage?.input_tokens) + number(usage?.output_tokens)
          : number(usage?.input_tokens) +
            number(usage?.cache_read_input_tokens) +
            number(usage?.cache_creation_input_tokens) +
            number(usage?.output_tokens);
      steps.push({
        kind: "end",
        text: bad
          ? oneLine(
              text(event.result) ||
                text(event.message) ||
                text(object(event.error)?.message) ||
                text(event.subtype) ||
                type,
              LINE,
            )
          : "",
        ...(used > 0 ? { tokens: used } : {}),
        ...(typeof event.total_cost_usd === "number" ? { usd: event.total_cost_usd } : {}),
        error: bad,
      });
    } else plain(line);
  }
  // past the limit the end still shows: it says what the session used
  const last = steps[steps.length - 1];
  const kept =
    steps.length > most && last?.kind === "end" ? [...steps.slice(0, most - 1), last] : steps.slice(0, most);
  return { steps: kept, quiet, hidden: steps.length - kept.length };
}

/** The panel member a session belongs to, from the name of its file (`04-review.correctness.jsonl`). Nobody for a lane's own agent, and for its later tries (`01-plan.2.jsonl`). */
export const memberOf = (path: string): string | undefined =>
  /(?:^|\/)\d+-[^./]+\.(?!\d+\.jsonl$)([^./]+)(?:\.\d+)?\.jsonl$/.exec(path)?.[1];
