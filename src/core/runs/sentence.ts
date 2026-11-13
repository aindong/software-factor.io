// One sentence for what a run is doing now, for the list of runs. It is made from the record
// alone. What an agent is doing is read from the last lines of its CLI's output, in the shapes
// Claude Code and Codex print. Those lines are the agent's words: they are cut to one line, and
// a line that is not understood is skipped.
import type { Parked } from "../engine/state.ts";
import { oneLine } from "../text.ts";

export interface Now {
  status: "running" | "waiting" | "done" | "dropped" | "stopped";
  stopCode?: string | null;
  reason?: string | null;
  /** The lane the run is at, by the name people see. */
  lane?: string;
  parked?: Parked["kind"];
  /** What the open lane is busy with. */
  phase?: "agent" | "gates" | "command" | "wait" | "panel";
  gatesDone?: number;
  gatesTotal?: number;
  /** Panel members at work. With the gates phase: the lane is a panel, and they have all ended. */
  members?: number;
  /** The last lane that passed and what it said, for a run that is done. */
  last?: { lane: string; said: string };
  /** The last part of the agent's output file. */
  tail?: string;
  /** The run is marked as moving, but the process that moved it is not there. */
  gone?: boolean;
  /** The run's task is in the queue again: the next `softwarefactor run` takes it. */
  queued?: boolean;
}

const MAX = 160;
const MAX_LINE = 1_000_000;

/** One line of at most `max` characters, never cut inside a character. */
function clip(text: string, max: number): string {
  const flat = oneLine(text, Number.MAX_SAFE_INTEGER);
  if (flat.length <= max) return flat;
  let cut = flat.slice(0, max - 3);
  // a word is not cut in two when a space is near enough
  const space = cut.lastIndexOf(" ");
  if (flat[max - 3] !== " " && space > max - 3 - 30) cut = cut.slice(0, space);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1); // half of a pair
  return `${cut}...`;
}

const FACTOR: Record<string, string> = {
  memory_read: "reading what the project remembers",
  memory_note: "leaving a note for later lanes",
  handoff_write: "handing off",
  ask_question: "asking a person",
  evidence_attach: "attaching evidence",
};
type Loose = Record<string, unknown>;
const object = (v: unknown): Loose | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Loose) : undefined;
const text = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);
const command = (given: unknown) => {
  const whole = text(given);
  if (!whole) return undefined;
  // Codex wraps every command in a login shell
  const inner = /^\S*(?:zsh|bash|sh) -lc (['"])([\s\S]*)\1$/.exec(whole)?.[2] ?? whole;
  // a command with a backtick of its own could close the quotes and go on in the factory's voice
  return `running \`${clip((inner.split("\n")[0] ?? "").replaceAll("`", "'"), 80)}\``;
};
const file = (given: unknown) => {
  const path = text(given);
  return path ? clip(oneLine(path, Number.MAX_SAFE_INTEGER).split("/").slice(-2).join("/"), 80) : undefined;
};

/** What one tool call is, in words. Nothing when the call has not what it takes to say. */
function claudeTool(name: string, input: Loose): string | undefined {
  if (name === "Bash") return command(input.command);
  if (name === "Read") return file(input.file_path) && `reading ${file(input.file_path)}`;
  if (name === "Write" || name === "Edit" || name === "NotebookEdit") {
    const path = file(input.file_path ?? input.notebook_path);
    return path && `writing ${path}`;
  }
  if (name === "Grep") return text(input.pattern) && `searching for "${clip(text(input.pattern) ?? "", 60)}"`;
  if (name === "Glob")
    return text(input.pattern) && `looking for files like "${clip(text(input.pattern) ?? "", 60)}"`;
  const ours = name.startsWith("mcp__factor__") ? name.slice("mcp__factor__".length) : "";
  // only a name of its own: every object answers to "constructor" too
  return Object.hasOwn(FACTOR, ours) ? FACTOR[ours] : `using ${clip(name, 40)}`;
}

function lineSays(line: string): string | undefined {
  if (line.length > MAX_LINE) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined; // cut in the middle, or not JSON
  }
  const event = object(parsed);
  if (!event) return undefined;
  if (event.type === "assistant") {
    // Claude Code: the last tool the message uses. Talk is passed over.
    const content = object(event.message)?.content;
    for (const part of Array.isArray(content) ? [...content].reverse() : []) {
      const use = object(part);
      const name = use?.type === "tool_use" ? text(use.name) : undefined;
      const said = name ? claudeTool(name, object(use?.input) ?? {}) : undefined;
      if (said) return said;
    }
    return undefined;
  }
  if (event.type === "item.started" || event.type === "item.completed") {
    const item = object(event.item);
    if (item?.type === "command_execution") return command(item.command);
    if (item?.type === "file_change") return "changing files";
    if (item?.type === "mcp_tool_call") {
      const tool = text(item.tool) ?? "";
      return item.server === "factor" && Object.hasOwn(FACTOR, tool) ? FACTOR[tool] : "using a tool";
    }
  }
  return undefined;
}

/** The latest thing the agent did, from the tail of its output. Nothing when nothing there is understood. */
export function activityOf(tail: string): string | undefined {
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const said = lineSays(lines[i] ?? "");
    if (said) return said;
  }
  return undefined;
}

// why a run stopped, when the record gives no reason of its own
const STOPPED: Record<string, string> = {
  lane_failed: "a lane failed",
  rejected: "a person rejected the work",
  out_of_rounds: "a loop ran out of rounds",
  no_progress: "a round brought no new work",
  budget_minutes: "out of its time budget",
  budget_tokens: "out of its token budget",
  budget_usd: "out of its cost budget",
  gate_stop: "a gate said stop",
  git_config_changed: "git's configuration changed during the run",
  interrupted: "the factory was interrupted",
  crashed: "the process that ran it ended without a word",
};
const WAITS: Record<Parked["kind"], string> = {
  "approve-before": "waits for your approval before it runs",
  "approve-after": "has finished and waits for your approval",
  answer: "asked a question and waits for your answer",
  wait: "waits for its condition and looks again by itself",
  account: "waits for its account's limit to lift",
};
const ended = (sentence: string) => (/[.!?]$/.test(sentence) ? sentence : `${sentence}.`);

function words(now: Now): string {
  const lane = now.lane ? clip(now.lane, 60) : undefined;
  const reason = now.reason ? oneLine(now.reason, Number.MAX_SAFE_INTEGER) : "";
  if (now.status === "done") {
    // what the last lane said (a ship's address, a merge) is what a person wants to know next
    return now.last?.said
      ? `Done. ${clip(now.last.lane, 60)}: ${clip(oneLine(now.last.said), 200)}`
      : "Done.";
  }
  if (now.status === "dropped") return reason ? `Dropped: ${reason}` : "Dropped.";
  if (now.status === "stopped") {
    if (now.stopCode === "stopped_by_person") return "Stopped by a person.";
    const why = reason || STOPPED[now.stopCode ?? ""];
    return why ? `Stopped: ${why}` : now.stopCode ? `Stopped (${clip(now.stopCode, 40)}).` : "Stopped.";
  }
  if (now.status === "waiting") {
    if (!lane) return "Waiting.";
    return `${lane} ${now.parked ? WAITS[now.parked] : "waits"}.`;
  }
  if (now.gone) {
    const gone = "its process is gone. The next `softwarefactor run` takes the run up again or ends it.";
    return lane ? `${lane}: ${gone}` : `I${gone.slice(1)}`;
  }
  if (!lane) return "Starting.";
  if (now.phase === "command") return `${lane}: its command is running.`;
  if (now.phase === "wait") return `${lane}: looking whether its condition holds.`;
  if (now.phase === "panel") {
    const n = now.members ?? 0;
    return `${lane}: ${n} ${n === 1 ? "reviewer is" : "reviewers are"} at work.`;
  }
  if (now.phase === "gates") {
    const [who, whose] =
      now.members === undefined ? ["the agent has", "its"] : ["its reviewers have", "their"];
    return (now.gatesTotal ?? 0) > 0
      ? `${lane}: ${who} finished and its gates are running (${now.gatesDone ?? 0} of ${now.gatesTotal} done).`
      : `${lane}: ${who} finished and the host is checking ${whose} work.`;
  }
  if (now.phase === "agent") return `${lane}: the agent is ${activityOf(now.tail ?? "") ?? "working"}.`;
  return `${lane}: working.`;
}

/** What a stopped or dropped run says once its task is queued again: the page shows the sentence without it. */
export const QUEUED =
  "Its task is queued again: the Run button on the Floor or `softwarefactor run` starts it.";

/** One line of at most 160 characters that says where the run is and what is happening. */
// What a lane said last may be an address, and a full stop glued to it would break it.
export function sentenceOf(now: Now): string {
  if (now.status === "done" && now.last?.said) {
    // a done run's line is cut where a sentence ends, when it is too long for the line
    const head = `Done. ${clip(now.last.lane, 60)}: `;
    const said = oneLine(now.last.said, Number.MAX_SAFE_INTEGER);
    const room = MAX - head.length;
    const end = [...said.slice(0, room + 1).matchAll(/[.!?](?=\s|$)/g)].at(-1);
    return said.length <= room || !end
      ? clip(`${head}${said}`, MAX)
      : `${head}${said.slice(0, (end.index ?? 0) + 1)}`;
  }
  const own = ended(words(now));
  if (!now.queued || (now.status !== "stopped" && now.status !== "dropped")) return clip(own, MAX);
  return `${clip(own, MAX - QUEUED.length - 1)} ${QUEUED}`;
}
