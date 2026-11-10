// From the correctness review of task 18: what a collector queues must also run. A task's key goes
// into its branch name, and a key from a schedule or from a server is not a branch name.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { edit, mcpServer, tasks } from "../helpers/collect.ts";
import { commandLane, flowRepo } from "../helpers/repo.ts";

it("runs a task the schedule queued", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  edit(repo, (w) => {
    w.collectors = [
      {
        id: "nightly",
        uses: "core/schedule@1",
        with: { cron: "* * * * *", title: "Update", body: "Run the updater." },
      },
    ];
  });
  const r = repo.sf("run");
  expect(repo.rows("select status from runs"), r.stdout + r.stderr).toEqual([{ status: "done" }]);
});

it("runs a task whose key from the server is not a branch name", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  edit(repo, (w) => {
    w.mcp = { board: mcpServer(repo, [{ id: "OPS 9: disk..~^?*[\\", title: "Disk nearly full" }]) };
    w.collectors = [{ id: "board", uses: "core/mcp-query@1", with: { server: "board", tool: "list_open" } }];
  });
  expect(repo.sf("allow", "board").status).toBe(0);
  const r = repo.sf("run");
  expect(repo.rows("select status from runs"), r.stdout + r.stderr).toEqual([{ status: "done" }]);
});

it("does not take a server's own request for the tool's answer", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")], tasks: "" });
  const script = join(repo.home, "pinging.mjs");
  writeFileSync(
    script,
    `import { createInterface } from "node:readline";
const say = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\\n");
for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (m.method === "initialize") say({ id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "s", version: "1" } } });
  if (m.method === "notifications/initialized") say({ id: 2, method: "ping" });
  if (m.method === "tools/call") say({ id: m.id, result: { content: [{ type: "text", text: JSON.stringify({ warnings: ["slow"], data: [{ id: 1, title: "", summary: "One" }, { id: "1", title: "The same key again" }] }) }], structuredContent: null } });
}
`,
  );
  edit(repo, (w) => {
    w.mcp = { board: { from: "command", command: process.execPath, args: [script] } };
    w.collectors = [{ id: "board", uses: "core/mcp-query@1", with: { server: "board", tool: "list_open" } }];
  });
  expect(repo.sf("allow", "board").status).toBe(0);
  const r = repo.sf("collect");
  expect(r.stdout, r.stderr).toContain("collected 1 new task");
  // the list of items is read, not the list of warnings; an empty title falls through to the summary; a key seen twice is said
  expect(tasks(repo).map((t) => `${t.key} ${t.title}`)).toEqual(["1 One"]);
  expect(r.stdout).toMatch(/collector board: 1 item skipped/);
});

it("brings a task that still waits up to date when it is found again, and leaves one that ran alone", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")], tasks: "" });
  const answer = join(repo.home, "mcp-answer.json");
  edit(repo, (w) => {
    w.mcp = { board: mcpServer(repo, [{ id: 1, title: "First words", labels: [] }]) };
    w.collectors = [{ id: "board", uses: "core/mcp-query@1", with: { server: "board", tool: "list_open" } }];
  });
  expect(repo.sf("allow", "board").status).toBe(0);
  expect(repo.sf("collect").stdout).toContain("collected 1 new task");
  writeFileSync(answer, JSON.stringify([{ id: 1, title: "Better words", labels: ["bug"] }]));
  expect(repo.sf("collect").stdout).toContain("collected 0 new tasks");
  expect(tasks(repo).map((t) => `${t.title} ${t.labels}`)).toEqual(['Better words ["bug"]']);
  expect(repo.sf("run").status).toBe(0);
  writeFileSync(answer, JSON.stringify([{ id: 1, title: "Words after the run", labels: [] }]));
  repo.sf("collect");
  expect(tasks(repo).map((t) => t.title)).toEqual(["Better words"]);
});
