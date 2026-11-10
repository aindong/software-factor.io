// core/mcp-query@1: one call of one tool on an MCP server, and a task for each item it answers
// with. This is how a board the factory has no collector for (Jira, an alerting tool) is read.
// The factory starts the server itself, with only the environment the workflow lists for it. A
// server that lives in an agent's profile or behind a URL is out of its reach.
import { spawnSync } from "node:child_process";
import { MINUTE_MS } from "../clock.ts";
import { hostEnv } from "../exec.ts";
import { own } from "../schema/builtins.ts";
import { oneLine } from "../text.ts";
import type { At, Collected, TaskDraft } from "./index.ts";

type Item = Record<string, unknown>;
const isItem = (v: unknown): v is Item => typeof v === "object" && v !== null && !Array.isArray(v);
const word = (v: unknown) =>
  typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : undefined;
const text = (v: unknown) => (typeof v === "string" ? v : undefined);
const names = (v: unknown) =>
  (Array.isArray(v) ? v : []).flatMap((l) =>
    typeof l === "string" ? [l] : isItem(l) && typeof l.name === "string" ? [l.name] : [],
  );

/** The list in a tool's answer: the answer itself, or the first list it holds under a usual name. */
function listIn(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (!isItem(value)) return undefined;
  for (const name of ["issues", "items", "tasks", "results"])
    if (Array.isArray(value[name])) return value[name];
  return Object.values(value).find(Array.isArray);
}

/** A task from one item: a plain item (`key` or `id`, `title`, `body`), or Jira's (`key`, `fields.summary`). */
function draftOf(item: unknown): TaskDraft | undefined {
  if (!isItem(item)) return undefined;
  const fields = isItem(item.fields) ? item.fields : {};
  const key = word(item.key) ?? word(item.id) ?? word(item.number);
  const title = text(item.title) ?? text(item.summary) ?? text(item.name) ?? text(fields.summary);
  if (!key || !title?.trim()) return undefined;
  return {
    key,
    title,
    body: text(item.body) ?? text(item.description) ?? text(fields.description) ?? "",
    labels: names(item.labels ?? fields.labels),
  };
}

export function collectMcp(at: At, settings: { server: string; tool: string; args?: Item }): Collected {
  const server = own(at.workflow.mcp, settings.server);
  if (server?.from !== "command") {
    const where = server?.from === "url" ? "is reached by a URL" : "is set up in an agent's profile";
    throw new Error(
      `the server "${settings.server}" ${where}, and the factory can only query a server it starts itself. Declare it with "from": "command" to collect from it.`,
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
    maxBuffer: 20_000_000,
  });
  let answer: { ok?: boolean; error?: string; result?: Item } = {};
  try {
    answer = JSON.parse(r.stdout);
  } catch {
    answer = { error: oneLine(r.stderr || r.error?.message || "the call gave no answer", 300) };
  }
  if (!answer.ok) throw new Error(answer.error ?? "the call failed");
  const result = answer.result ?? {};
  const said = (Array.isArray(result.content) ? result.content : [])
    .flatMap((c) => (isItem(c) && typeof c.text === "string" ? [c.text] : []))
    .join("\n");
  if (result.isError) throw new Error(oneLine(said || "the tool answered with an error", 300));
  let value: unknown = result.structuredContent;
  if (value === undefined) {
    try {
      value = JSON.parse(said);
    } catch {
      throw new Error("the tool's answer is not JSON");
    }
  }
  const list = listIn(value);
  if (!list) throw new Error("the tool's answer holds no list of items");
  const tasks = list.flatMap((item) => draftOf(item) ?? []);
  const skipped = list.length - tasks.length;
  return {
    tasks,
    said: skipped ? `${skipped} item${skipped === 1 ? "" : "s"} skipped (no key or no title)` : undefined,
  };
}
