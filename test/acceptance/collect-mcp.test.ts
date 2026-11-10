// core/mcp-query@1: one call of a tool on an MCP server the factory starts, and a task for each item.
import { expect, it } from "vitest";
import { edit, mcpCalls, mcpServer, tasks } from "../helpers/collect.ts";
import { commandLane, flowRepo, type Repo } from "../helpers/repo.ts";

function querying(repo: Repo, answer: unknown, args?: Record<string, unknown>) {
  edit(repo, (w) => {
    w.mcp = { board: mcpServer(repo, answer) };
    w.collectors = [
      {
        id: "board",
        uses: "core/mcp-query@1",
        with: { server: "board", tool: "list_open", ...(args ? { args } : {}) },
      },
    ];
  });
}

it("calls the tool with the arguments and adds a task for each item of a plain list", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  querying(
    repo,
    [
      { id: 41, title: "Latency alert on checkout", body: "p95 over 2s", labels: ["alert"] },
      { key: "OPS-9", title: "Disk nearly full" },
      { title: "No key at all" },
      { id: 5 },
      "not an item",
    ],
    { status: "open", limit: 20 },
  );
  const r = repo.sf("collect");
  expect(r.status, r.stderr).toBe(0);
  expect(mcpCalls(repo).map((c) => c.call)).toEqual([
    { name: "list_open", arguments: { status: "open", limit: 20 } },
  ]);
  expect(tasks(repo)).toEqual([
    {
      collector: "board",
      key: "41",
      title: "Latency alert on checkout",
      body: "p95 over 2s",
      labels: '["alert"]',
    },
    { collector: "board", key: "OPS-9", title: "Disk nearly full", body: "", labels: "[]" },
  ]);
  expect(r.stdout).toContain("collected 2 new tasks");
  expect(r.stdout).toMatch(/collector board: 3 items skipped/);
  expect(repo.sf("collect").stdout).toContain("collected 0 new tasks");
});

it("reads Jira's shape: issues with a key and fields", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  querying(repo, {
    total: 2,
    issues: [
      {
        key: "APP-12",
        fields: {
          summary: "Export fails on empty carts",
          description: "Seen on the cart page.",
          labels: ["factory"],
        },
      },
      // a description that is not text (Jira's document format) is left out, not printed as JSON
      { key: "APP-13", fields: { summary: "Add a dark theme", description: { type: "doc", content: [] } } },
    ],
  });
  const r = repo.sf("collect");
  expect(r.status, r.stderr).toBe(0);
  expect(tasks(repo)).toEqual([
    {
      collector: "board",
      key: "APP-12",
      title: "Export fails on empty carts",
      body: "Seen on the cart page.",
      labels: '["factory"]',
    },
    { collector: "board", key: "APP-13", title: "Add a dark theme", body: "", labels: "[]" },
  ]);
});
