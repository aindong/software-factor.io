// From the security review of task 18: a server started through a launcher (npx, uvx, docker) is
// a grandchild. Collecting must come back, and must not leave it running.
import { expect, it } from "vitest";
import { alive, edit, mcpCalls, mcpServer, tasks } from "../helpers/collect.ts";
import { commandLane, flowRepo } from "../helpers/repo.ts";

it.each(["ok", "silent"] as const)(
  "returns when the server is its command's own child, as with npx (%s)",
  (mode) => {
    const repo = flowRepo({ lanes: [commandLane("build", "true")], tasks: "" });
    const s = mcpServer(repo, [{ id: 1, title: "One" }], mode) as { command: string; args: string[] };
    const line = `${[s.command, ...s.args].map((a) => `'${a}'`).join(" ")}; :`; // "; :" stops sh from becoming it
    edit(repo, (w) => {
      w.mcp = { board: { from: "command", command: "sh", args: ["-c", line] } };
      w.collectors = [
        { id: "board", uses: "core/mcp-query@1", with: { server: "board", tool: "list_open" } },
      ];
    });
    expect(repo.sf("allow", "board").status).toBe(0);
    repo.env.FACTOR_MINUTE_MS = "1500";
    const started = Date.now();
    try {
      const r = repo.sf("collect");
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(r.stdout).toMatch(
        mode === "ok" ? /collected 1 new task/ : /collector board: could not collect: .*did not answer/,
      );
      expect(tasks(repo)).toHaveLength(mode === "ok" ? 1 : 0);
      expect(mcpCalls(repo).some((c) => alive(c.pid))).toBe(false);
    } finally {
      for (const c of mcpCalls(repo)) {
        try {
          process.kill(c.pid, "SIGKILL");
        } catch {
          // already gone, as it should be
        }
      }
    }
  },
  40_000,
);
