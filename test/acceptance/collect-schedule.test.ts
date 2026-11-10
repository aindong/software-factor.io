// core/schedule@1: one task each time the clock comes round, keyed by the time it was due.
import { expect, it } from "vitest";
import { edit, tasks } from "../helpers/collect.ts";
import { commandLane, flowRepo, type Repo } from "../helpers/repo.ts";

/** Collect as if it were this moment. The machine is in New York: a schedule is read in local time, and the test shows it. */
function collectAt(repo: Repo, when: string) {
  repo.env.TZ = "America/New_York";
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

it("adds one task for each time the schedule was due, in local time, and none twice", () => {
  // 14:00 UTC is 10:00 in New York, 02:15 UTC the next day is still the evening before there, 07:30 UTC is 03:30
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  scheduled(repo, "0 3 * * *");
  const first = collectAt(repo, "2031-05-06T14:00:20Z");
  expect(first.stdout, first.stderr).toContain("collected 1 new task");
  expect(collectAt(repo, "2031-05-07T02:15:00Z").stdout).toContain("collected 0 new tasks");
  expect(collectAt(repo, "2031-05-07T07:30:00Z").stdout).toContain("collected 1 new task");
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
  const r = collectAt(repo, "2031-05-06T14:00:00Z");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toContain("collected 0 new tasks");
  expect(tasks(repo)).toEqual([]);
});
