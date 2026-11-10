// A collector that cannot collect says why, by name, and the others still collect.
import { expect, it } from "vitest";
import { edit, standIn, tasks } from "../helpers/collect.ts";
import { commandLane, flowRepo } from "../helpers/repo.ts";

it("collects from the file when gh is not signed in, and says what gh said", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")], tasks: "- [ ] From the file\n" });
  edit(repo, (w) => {
    w.collectors = [
      { id: "issues", uses: "core/github-issues@1", with: { label: "factory" } },
      { id: "tasks", uses: "core/file@1", with: { path: ".factor/tasks.md" } },
    ];
  });
  standIn(repo, "gh", 'echo "To get started with GitHub CLI, please run:  gh auth login" >&2; exit 4');
  const r = repo.sf("collect");
  expect(r.status, r.stderr).toBe(0);
  expect(tasks(repo).map((t) => `${t.collector}:${t.title}`)).toEqual(["tasks:From the file"]);
  expect(r.stdout).toContain("collected 1 new task");
  expect(r.stdout).toMatch(/collector issues: could not collect: .*gh auth login/);
});

it("says so when gh prints something that is not a list of issues", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  edit(repo, (w) => {
    w.collectors = [{ id: "issues", uses: "core/github-issues@1", with: { label: "factory" } }];
  });
  standIn(repo, "gh", "echo 'not json'");
  const r = repo.sf("collect");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toMatch(/collector issues: could not collect: /);
  expect(tasks(repo)).toEqual([]);
});
