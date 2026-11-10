// The operator MCP server and the interface's operations, as the tests of task 16 call them.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { jsonOf, type Repo, type Ui } from "./repo.ts";

const CLI = resolve("src/cli.ts");

export interface OperatorAnswer {
  id: number | null;
  result?: { content?: { type: string; text: string }[]; isError?: boolean; tools?: unknown[] };
  error?: { code: number; message: string };
}
/** Speak to `softwarefactor mcp --operator`: send these messages, get every answer back. */
export function operator(repo: Repo, messages: unknown[], env: Record<string, string> = {}) {
  const input = messages.map((m) => JSON.stringify(m)).join("\n");
  const r = spawnSync(process.execPath, [CLI, "mcp", "--operator", "--workspace", repo.dir], {
    input: `${input}\n`,
    encoding: "utf8",
    env: { ...process.env, FACTOR_HOME: repo.home, ...repo.env, ...env },
  });
  const answers = r.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as OperatorAnswer);
  return { answers, status: r.status, stderr: r.stderr };
}
/** Call one operation through the MCP server: its result as data, or the refusal's words. */
export function tool<T = Record<string, unknown>>(repo: Repo, name: string, args: unknown = {}) {
  const call = { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } };
  const answer = operator(repo, [call]).answers.find((a) => a.id === 7);
  const text = answer?.result?.content?.[0]?.text ?? answer?.error?.message ?? "";
  const refused = answer?.result?.isError === true || answer?.error !== undefined;
  return { refused, text, data: (refused ? undefined : JSON.parse(text)) as T };
}
/** Call one operation through the interface's API. */
export async function op<T = Record<string, unknown>>(ui: Ui, name: string, input: unknown = {}) {
  // A test that has just run a command held this process up, and the server may have closed an idle
  // connection meanwhile. One turn of the loop lets that be seen before the connection is used again.
  await new Promise((seen) => setImmediate(seen));
  const answer = await ui.api(`/api/op/${name}`, { method: "POST", body: input });
  return {
    status: answer.status,
    body: await jsonOf<T & { error?: string; fix?: string; path?: string }>(answer),
  };
}
