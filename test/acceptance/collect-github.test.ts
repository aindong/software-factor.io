// core/github-issues@1: open issues with a label become tasks, once each.
import { expect, it } from "vitest";
import { calls, edit, standIn, tasks } from "../helpers/collect.ts";
import { commandLane, flowRepo } from "../helpers/repo.ts";

const ISSUES = JSON.stringify([
  {
    number: 12,
    title: "Export fails on empty carts",
    body: "Steps:\n1. Empty the cart",
    labels: [{ name: "factory" }, { name: "bug" }],
  },
  { number: 7, title: "Add a dark theme", body: "", labels: [{ name: "factory" }] },
]);

it("collects the open issues with the label, once each, and asks gh for that label", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  edit(repo, (w) => {
    w.collectors = [{ id: "issues", uses: "core/github-issues@1", with: { label: "factory" } }];
  });
  const log = standIn(repo, "gh", `cat << 'JSON'\n${ISSUES}\nJSON`);

  const first = repo.sf("collect");
  expect(first.status, first.stderr).toBe(0);
  expect(first.stdout).toContain("collected 2 new tasks");
  expect(tasks(repo)).toEqual([
    {
      collector: "issues",
      key: "#12",
      title: "Export fails on empty carts",
      body: "Steps:\n1. Empty the cart",
      labels: '["factory","bug"]',
    },
    { collector: "issues", key: "#7", title: "Add a dark theme", body: "", labels: '["factory"]' },
  ]);
  const asked = calls(log)[0] ?? "";
  expect(asked).toMatch(/^issue list /);
  expect(asked).toContain("--label factory");
  expect(asked).toContain("--state open");
  expect(asked).not.toContain("--repo");

  expect(repo.sf("collect").stdout).toContain("collected 0 new tasks");
  expect(tasks(repo)).toHaveLength(2);
});

it("names the repository when the workflow does", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  edit(repo, (w) => {
    w.collectors = [
      { id: "issues", uses: "core/github-issues@1", with: { label: "factory", repo: "acme/shop" } },
    ];
  });
  const log = standIn(repo, "gh", "echo '[]'");
  expect(repo.sf("collect").status).toBe(0);
  expect(calls(log)[0]).toContain("--repo acme/shop");
});
