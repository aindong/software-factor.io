// The MCP server a collector starts gets only the environment the workflow lists for it, and a
// server that fails is said by name while the other collectors go on.
import { expect, it } from "vitest";
import { alive, edit, type McpMode, mcpCalls, mcpServer, tasks } from "../helpers/collect.ts";
import { commandLane, flowRepo, type Repo } from "../helpers/repo.ts";

function querying(repo: Repo, mode: McpMode, env?: string[]) {
  edit(repo, (w) => {
    w.mcp = { board: { ...mcpServer(repo, [{ id: 1, title: "One" }], mode), ...(env ? { env } : {}) } };
    w.collectors = [
      { id: "board", uses: "core/mcp-query@1", with: { server: "board", tool: "list_open" } },
      { id: "tasks", uses: "core/file@1", with: { path: ".factor/tasks.md" } },
    ];
  });
}

it("gives the server the variables the workflow lists, and no other of the caller's", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")], tasks: "" });
  querying(repo, "ok", ["BOARD_TOKEN"]);
  repo.env.BOARD_TOKEN = "listed";
  repo.env.OTHER_SECRET = "not listed";
  const r = repo.sf("collect");
  expect(r.status, r.stderr).toBe(0);
  const env = mcpCalls(repo)[0]?.env ?? [];
  expect(env).toContain("BOARD_TOKEN");
  expect(env).toContain("PATH");
  expect(env).not.toContain("OTHER_SECRET");
  expect(env).not.toContain("FACTOR_HOME");
  expect(r.stdout + r.stderr).not.toContain("listed");
});

it.each([
  ["error", /collector board: could not collect: .*the board is closed/],
  ["rpc-error", /collector board: could not collect: .*no such tool on this board/],
  ["crash", /collector board: could not collect: .*could not start/],
  ["silent", /collector board: could not collect: .*did not answer/],
] as const)("says so when the server answers with %s, and still collects the file's tasks", (mode, said) => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")], tasks: "- [ ] From the file\n" });
  querying(repo, mode);
  repo.env.FACTOR_MINUTE_MS = "1500"; // the wait for an answer is one minute
  const r = repo.sf("collect");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toMatch(said);
  expect(tasks(repo).map((t) => `${t.collector}:${t.title}`)).toEqual(["tasks:From the file"]);
  // a server that did not answer is not left running
  expect(mcpCalls(repo).some((c) => alive(c.pid))).toBe(false);
});
