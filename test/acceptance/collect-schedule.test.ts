// core/schedule@1: one task each time the clock comes round, keyed by the time it was due.
import { expect, it } from "vitest";
import { edit, tasks } from "../helpers/collect.ts";
import { commandLane, flowRepo, type Repo } from "../helpers/repo.ts";

/** Collect as if it were this moment (UTC). */
function collectAt(repo: Repo, when: string) {
  repo.env.TZ = "UTC";
  repo.env.FACTOR_CLOCK_OFFSET_MS = String(Date.parse(when) - Date.now());
  return repo.sf("collect");
}
const scheduled = (repo: Repo, cron: string) =>
  edit(repo, (w) => {
    w.collectors = [
      {
        id: "nightly",
        uses: "core/schedule@1",
        with: { cron, title: "Update the dependencies", body: "Run the updater." },
      },
    ];
  });

it("adds one task for each time the schedule was due, and none twice", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  scheduled(repo, "0 3 * * *");
  const first = collectAt(repo, "2031-05-06T10:00:20Z");
  expect(first.stdout, first.stderr).toContain("collected 1 new task");
  expect(collectAt(repo, "2031-05-06T22:15:00Z").stdout).toContain("collected 0 new tasks");
  expect(collectAt(repo, "2031-05-07T03:30:00Z").stdout).toContain("collected 1 new task");
  expect(tasks(repo)).toEqual([
    {
      collector: "nightly",
      key: "2031-05-06T03:00",
      title: "Update the dependencies",
      body: "Run the updater.",
      labels: "[]",
    },
    {
      collector: "nightly",
      key: "2031-05-07T03:00",
      title: "Update the dependencies",
      body: "Run the updater.",
      labels: "[]",
    },
  ]);
});

it("adds nothing for a schedule that was not due in the last 31 days", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  scheduled(repo, "0 0 30 2 *"); // the 30th of February
  const r = collectAt(repo, "2031-05-06T10:00:00Z");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toContain("collected 0 new tasks");
  expect(tasks(repo)).toEqual([]);
});
