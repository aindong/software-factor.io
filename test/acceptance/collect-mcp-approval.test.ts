// From the security review of task 18: a workflow can come from someone else. The command it names
// for an MCP server is not started, and gets none of the person's variables, until the person has
// seen it and allowed it on this machine. A change to it asks again.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { edit, mcpCalls, mcpServer, tasks } from "../helpers/collect.ts";
import { commandLane, flowRepo } from "../helpers/repo.ts";

it("does not start a server the workflow names before a person allowed it", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")], tasks: "- [ ] From the file\n" });
  const marker = join(repo.home, "server-ran");
  edit(repo, (w) => {
    w.mcp = { board: { from: "command", command: "touch", args: [marker], env: ["BOARD_TOKEN"] } };
    w.collectors = [
      { id: "board", uses: "core/mcp-query@1", with: { server: "board", tool: "list_open" } },
      { id: "tasks", uses: "core/file@1", with: { path: ".factor/tasks.md" } },
    ];
  });
  for (const command of ["collect", "run"]) {
    const r = repo.sf(command);
    expect(existsSync(marker), command).toBe(false);
    expect(r.stdout + r.stderr, command).toMatch(
      /collector board: could not collect: the server "board" is not allowed on this machine yet\. .*softwarefactor allow board/,
    );
  }
  expect(tasks(repo).map((t) => t.title)).toEqual(["From the file"]);
});

it("shows what the server runs and which variables it gets, and then starts it", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")], tasks: "" });
  const server = mcpServer(repo, [{ id: 1, title: "One" }]) as { command: string; args: string[] };
  edit(repo, (w) => {
    w.mcp = { board: { ...server, env: ["BOARD_TOKEN"] } };
    w.collectors = [{ id: "board", uses: "core/mcp-query@1", with: { server: "board", tool: "list_open" } }];
  });
  repo.env.BOARD_TOKEN = "a-value-that-is-never-shown";
  const allowed = repo.sf("allow", "board");
  expect(allowed.status, allowed.stderr).toBe(0);
  expect(allowed.stdout).toContain(JSON.stringify([server.command, ...server.args]));
  expect(allowed.stdout).toContain("BOARD_TOKEN");
  expect(allowed.stdout).not.toContain("a-value-that-is-never-shown");
  expect(repo.sf("collect").stdout).toContain("collected 1 new task");

  // the workflow now asks for one more variable: that is a different thing to allow
  edit(repo, (w) => {
    (w.mcp as { board: { env: string[] } }).board.env = ["BOARD_TOKEN", "ANTHROPIC_API_KEY"];
  });
  repo.env.ANTHROPIC_API_KEY = "not-a-real-key";
  const again = repo.sf("collect");
  expect(again.stdout).toMatch(
    /collector board: could not collect: the server "board" has changed since it was allowed/,
  );
  expect(mcpCalls(repo)).toHaveLength(1);
  expect(mcpCalls(repo)[0]?.env).not.toContain("ANTHROPIC_API_KEY");
});

it("refuses to allow a server the workflow does not have, or one it cannot start", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  edit(repo, (w) => {
    w.mcp = { atlassian: { from: "url", url: "https://mcp.example.com/sse" } };
  });
  for (const name of ["nothing", "atlassian"]) {
    const r = repo.sf("allow", name);
    expect(r.status, name).toBe(1);
    expect(r.stderr, name).toContain(name);
  }
});
