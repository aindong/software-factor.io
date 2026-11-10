// A person accepts a suggestion: the workflow's file changes, and the count starts again.
import { expect, it } from "vitest";
import { checkpointOf, cleanRun, ladderLine, ladderRepo, lastRun } from "../helpers/ladder.ts";

it("moves the lane a step up in the workflow's file, records the move, and the lane no longer waits", () => {
  const repo = ladderRepo();
  cleanRun(repo);
  cleanRun(repo);
  const r = repo.sf("ladder", "accept", "build");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toMatch(/build is now near the loop/);
  expect(checkpointOf(repo)).toBe("near");
  expect(repo.sf("check").status).toBe(0);
  expect(repo.rows("select lane, kind, from_mode, to_mode, note from ladder where kind <> 'seen'")).toEqual([
    {
      lane: "build",
      kind: "promoted",
      from_mode: "in",
      to_mode: "near",
      note: "2 runs in a row approved as they were",
    },
  ]);
  expect(ladderLine(repo)).toMatch(/build\s+near the loop\s+0 of 2/);
  expect(ladderLine(repo)).toMatch(/moved near the loop on \d{4}-\d{2}-\d{2}/);
  // the next run goes through the lane without asking
  repo.sf("run");
  expect(
    repo.rows(
      "select count(*) as n from inbox where lane = 'build' and created_at > (select max(at) from ladder)",
    ),
  ).toEqual([{ n: 0 }]);
  expect(lastRun(repo).status).toBe("done");
});

it("refuses to move a lane that has no suggestion, and a lane the workflow does not have", () => {
  const repo = ladderRepo();
  cleanRun(repo);
  const early = repo.sf("ladder", "accept", "build");
  expect(early.status).toBe(1);
  expect(early.stderr).toMatch(/1 of 2/);
  expect(checkpointOf(repo)).toBe("in");
  expect(repo.sf("ladder", "accept", "nothing").status).toBe(1);
  expect(repo.rows("select count(*) as n from ladder where kind <> 'seen'")).toEqual([{ n: 0 }]);
});
