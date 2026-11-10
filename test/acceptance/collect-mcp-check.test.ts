// A server that lives in an agent's profile, or behind a URL, is not one the factory can start:
// the workflow is still valid (a lane's agent can use it), and collecting says what to change.
import { expect, it } from "vitest";
import { edit, tasks } from "../helpers/collect.ts";
import { commandLane, flowRepo } from "../helpers/repo.ts";

it.each([
  ["profile", { from: "profile" }],
  ["url", { from: "url", url: "https://mcp.example.com/sse" }],
] as const)("says that a server from a %s cannot be queried, and how to change that", (_, server) => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")], tasks: "- [ ] From the file\n" });
  edit(repo, (w) => {
    w.mcp = { atlassian: server };
    w.collectors = [
      {
        id: "tickets",
        uses: "core/mcp-query@1",
        with: { server: "atlassian", tool: "searchJiraIssuesUsingJql", args: { jql: "labels = factory" } },
      },
      { id: "tasks", uses: "core/file@1", with: { path: ".factor/tasks.md" } },
    ];
  });
  expect(repo.sf("check").status).toBe(0);
  const r = repo.sf("collect");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toMatch(/collector tickets: could not collect: .*"atlassian".*"from": "command"/);
  expect(tasks(repo).map((t) => t.title)).toEqual(["From the file"]);
});
