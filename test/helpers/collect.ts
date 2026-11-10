// Helpers for the collector tests: change the test workflow, put a stand-in program on PATH, and
// a stand-in MCP server that answers one tool from a file and writes down what it was asked.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Repo } from "./repo.ts";

type Json = Record<string, unknown>;

/** Change the test workflow in place. */
export function edit(repo: Repo, change: (workflow: Json & { collectors: Json[] }) => void): void {
  const path = ".factor/workflows/starter.json";
  const workflow = repo.json<Json & { collectors: Json[] }>(path);
  change(workflow);
  repo.write(path, `${JSON.stringify(workflow, null, 2)}\n`);
}

/** Put a shell script on PATH under a program's name. Returns the file its calls are written to, one line each. */
export function standIn(repo: Repo, name: string, body: string): string {
  const bin = join(repo.home, "bin");
  mkdirSync(bin, { recursive: true });
  const log = join(repo.home, `${name}.calls`);
  writeFileSync(join(bin, name), `#!/bin/sh\necho "$*" >> "${log}"\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
  repo.env.PATH = `${bin}:${process.env.PATH}`;
  return log;
}

export const calls = (log: string) => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);

export const tasks = (repo: Repo) =>
  repo.rows<{ collector: string; key: string; title: string; body: string; labels: string }>(
    "select collector, key, title, body, labels from tasks order by id",
  );

/**
 * A stand-in MCP server over stdio, as a command for the workflow's "mcp". It answers `tools/call`
 * with the text in `answer` (or as the mode says), and writes each call and the names of the
 * environment variables it was given to `<home>/mcp.calls`.
 */
export function mcpServer(
  repo: Repo,
  answer: unknown,
  mode: "ok" | "error" | "silent" | "crash" = "ok",
): Json {
  const script = join(repo.home, "mcp-stand-in.mjs");
  const log = join(repo.home, "mcp.calls");
  writeFileSync(join(repo.home, "mcp-answer.json"), JSON.stringify(answer));
  writeFileSync(
    script,
    `import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
const [log, answer, mode] = process.argv.slice(2);
if (mode === "crash") { console.error("the stand-in server could not start"); process.exit(3); }
const say = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (m.method === "initialize") say({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "stand-in", version: "1" } } });
  if (m.method === "tools/call") {
    appendFileSync(log, JSON.stringify({ call: m.params, env: Object.keys(process.env).sort() }) + "\\n");
    if (mode === "silent") continue;
    if (mode === "error") say({ jsonrpc: "2.0", id: m.id, result: { isError: true, content: [{ type: "text", text: "the board is closed" }] } });
    else say({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: readFileSync(answer, "utf8") }] } });
  }
}
`,
  );
  return {
    from: "command",
    command: process.execPath,
    args: [script, log, join(repo.home, "mcp-answer.json"), mode],
  };
}

export const mcpCalls = (repo: Repo) =>
  calls(join(repo.home, "mcp.calls")).map(
    (line) => JSON.parse(line) as { call: { name: string; arguments: Json }; env: string[] },
  );
