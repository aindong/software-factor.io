// core/mcp-query@1: one call of one tool on an MCP server, and a task for each item it answers
// with. This is how a board the factory has no collector for (Jira, an alerting tool) is read.
// The factory starts the server itself, with only the environment the workflow lists for it. A
// server that lives in an agent's profile or behind a URL is out of its reach.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { MINUTE_MS } from "../clock.ts";
import { hostEnv } from "../exec.ts";
import { own } from "../schema/builtins.ts";
import { oneLine } from "../text.ts";
import type { At, Collected, TaskDraft } from "./index.ts";

type Item = Record<string, unknown>;
const isItem = (v: unknown): v is Item => typeof v === "object" && v !== null && !Array.isArray(v);
const word = (v: unknown) =>
  typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : undefined;
const names = (v: unknown) =>
  (Array.isArray(v) ? v : []).flatMap((l) =>
    typeof l === "string" ? [l] : isItem(l) && typeof l.name === "string" ? [l.name] : [],
  );

const MOST = 100;
const firstText = (...values: unknown[]) =>
  values.find((v): v is string => typeof v === "string" && v.trim() !== "");

/** The list in a tool's answer: the answer itself, or the list it holds under a usual name, or its first list of items. */
function listIn(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (!isItem(value)) return undefined;
  for (const name of ["issues", "items", "tasks", "results"])
    if (Array.isArray(value[name])) return value[name];
  return Object.values(value).find((v): v is unknown[] => Array.isArray(v) && v.some(isItem));
}

/** A task from one item: a plain item (`key` or `id`, `title`, `body`), or Jira's (`key`, `fields.summary`). */
function draftOf(item: unknown): TaskDraft | undefined {
  if (!isItem(item)) return undefined;
  const fields = isItem(item.fields) ? item.fields : {};
  const key = word(item.key) ?? word(item.id) ?? word(item.number);
  const title = firstText(item.title, item.summary, item.name, fields.summary);
  if (!key || !title) return undefined;
  return {
    key,
    title,
    body: firstText(item.body, item.description, fields.description) ?? "",
    labels: names(item.labels ?? fields.labels),
  };
}

type Server = { command: string; args?: string[]; env?: string[] };
// as a list in JSON: an argument with spaces or a line break in it cannot pass for two, or hide one
const shown = (s: Server) =>
  `${JSON.stringify([s.command, ...(s.args ?? [])])}${s.env?.length ? ` (with your ${s.env.join(", ")})` : ""}`;
/** What a server runs and which variables it gets, as one print: a change to either is a different server. */
export const printOf = (s: Server) =>
  createHash("sha256")
    .update(JSON.stringify([s.command, s.args ?? [], [...(s.env ?? [])].sort()]))
    .digest("hex");
export const describeServer = shown;

export function collectMcp(at: At, settings: { server: string; tool: string; args?: Item }): Collected {
  const server = own(at.workflow.mcp, settings.server);
  if (server?.from !== "command") {
    const where = server?.from === "url" ? "is reached by a URL" : "is set up in an agent's profile";
    throw new Error(
      `the server "${settings.server}" ${where}, and the factory can only query a server it starts itself. Declare it with "from": "command" to collect from it.`,
    );
  }
  // A workflow can come from someone else. What it names here runs on this machine with the
  // person's variables, so the person sees it once and allows it, and is asked again when it changes.
  const allowed = own(at.servers, settings.server);
  if (allowed !== printOf(server)) {
    throw new Error(
      `the server "${settings.server}" ${allowed ? "has changed since it was allowed" : "is not allowed on this machine yet"}. It would run: ${shown(server)}. Allow it with: softwarefactor allow ${settings.server}`,
    );
  }
  // the call waits for an answer, and the engine does not: it runs in a process of its own
  const r = spawnSync(process.execPath, [process.argv[1] ?? "", "mcp-call"], {
    cwd: at.root,
    encoding: "utf8",
    env: hostEnv(server.env ?? []),
    input: JSON.stringify({
      command: server.command,
      args: server.args ?? [],
      tool: settings.tool,
      arguments: settings.args ?? {},
      timeoutMs: MINUTE_MS,
    }),
    timeout: MINUTE_MS + 10_000,
    killSignal: "SIGKILL",
    maxBuffer: 20_000_000,
  });
  let answer: { ok?: boolean; error?: string; result?: Item } | null = null;
  try {
    answer = JSON.parse(r.stdout ?? "");
  } catch {
    answer = null;
  }
  if (!answer) throw new Error(oneLine(r.error?.message || r.stderr || "the call gave no answer", 300));
  if (!answer.ok) throw new Error(answer.error ?? "the call failed");
  const result = answer.result ?? {};
  const said = (Array.isArray(result.content) ? result.content : [])
    .flatMap((c) => (isItem(c) && typeof c.text === "string" ? [c.text] : []))
    .join("\n");
  if (result.isError) throw new Error(oneLine(said || "the tool answered with an error", 300));
  let value: unknown = result.structuredContent ?? undefined;
  if (value === undefined) {
    try {
      value = JSON.parse(said);
    } catch {
      throw new Error("the tool's answer is not JSON");
    }
  }
  return tasksIn(value);
}

/** The tasks in an answer: a list of items, or an object that holds one. */
export function tasksIn(value: unknown): Collected {
  const list = listIn(value);
  if (!list) throw new Error("the tool's answer holds no list of items");
  const seen = new Set<string>();
  const tasks = list.slice(0, MOST).flatMap((item) => {
    const draft = draftOf(item);
    if (!draft || seen.has(draft.key)) return []; // a key seen twice is one task, and the second is said
    seen.add(draft.key);
    return [draft];
  });
  const skipped = Math.min(list.length, MOST) - tasks.length;
  const notes = [
    skipped
      ? `${skipped} item${skipped === 1 ? "" : "s"} skipped (no key, no title, or a key seen twice)`
      : "",
    list.length > MOST ? `only the first ${MOST} items were read` : "",
  ].filter(Boolean);
  return { tasks, said: notes.join(", ") || undefined };
}
