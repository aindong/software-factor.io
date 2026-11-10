// A task's labels are facts a route can read: `task.labels` was always an empty list before.
import { expect, it } from "vitest";
import { edit, standIn } from "../helpers/collect.ts";
import { commandLane, flowRepo } from "../helpers/repo.ts";

it("sends a task with the label one way and a task without it the other", () => {
  const repo = flowRepo({
    lanes: [
      commandLane("sort", "true", {
        on: {
          pass: [{ to: "bugfix", when: { ref: "task.labels", in: ["bug"] } }, { to: "feature" }],
          fail: "@stop",
        },
      }),
      commandLane("bugfix", "true"),
      commandLane("feature", "true"),
    ],
  });
  edit(repo, (w) => {
    w.collectors = [{ id: "issues", uses: "core/github-issues@1", with: { label: "factory" } }];
  });
  const issues = [
    { number: 1, title: "A bug", body: "", labels: [{ name: "factory" }, { name: "bug" }] },
    { number: 2, title: "A feature", body: "", labels: [{ name: "factory" }] },
  ];
  standIn(repo, "gh", `cat << 'JSON'\n${JSON.stringify(issues)}\nJSON`);
  const r = repo.sf("run", "--all", "--parallel", "1");
  const went = repo.rows<{ key: string; lanes: string }>(
    "select t.key as key, group_concat(l.lane, '>') as lanes from lane_runs l join runs r on r.id = l.run_id join tasks t on t.id = r.task_id group by t.key order by t.key",
  );
  expect(went, r.stdout + r.stderr).toEqual([
    { key: "#1", lanes: "sort>bugfix" },
    { key: "#2", lanes: "sort>feature" },
  ]);
});
