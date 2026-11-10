// A pinned lane, a one-way lane and a lane already out of the loop are never moved up.
import { expect, it } from "vitest";
import { checkpointOf, cleanRun, ladderLine, ladderRepo } from "../helpers/ladder.ts";

it.each([
  ["pin", { pin: true }, /pinned/],
  [
    "oneWay",
    { oneWay: true, on: { pass: "ship", fail: "@stop", needsPerson: "@stop" } },
    /cannot be undone|one-way/,
  ],
] as const)("never suggests a lane marked %s, and refuses to move it", (_, extra, why) => {
  const repo = ladderRepo(extra);
  cleanRun(repo);
  cleanRun(repo);
  cleanRun(repo);
  expect(ladderLine(repo)).not.toMatch(/can move/);
  expect(ladderLine(repo)).toMatch(why);
  const r = repo.sf("ladder", "accept", "build");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(why);
  expect(checkpointOf(repo)).toBe("in");
});

it("moves a lane near the loop out of it on a second record, and no further", () => {
  const repo = ladderRepo();
  cleanRun(repo);
  cleanRun(repo);
  expect(repo.sf("ladder", "accept", "build").status).toBe(0);
  cleanRun(repo);
  cleanRun(repo);
  expect(ladderLine(repo)).toMatch(/near the loop\s+2 of 2.*can move out of the loop/);
  expect(repo.sf("ladder", "accept", "build").status).toBe(0);
  expect(checkpointOf(repo)).toBe("out");
  cleanRun(repo);
  cleanRun(repo);
  expect(ladderLine(repo)).not.toMatch(/can move/);
  expect(repo.sf("ladder", "accept", "build").status).toBe(1);
});

it("records an escape at a pinned lane near the loop and leaves it where it is pinned", () => {
  const repo = ladderRepo({ pin: true, checkpoint: "near" });
  const run = cleanRun(repo);
  const r = repo.sf("escape", run, "--lane", "build", "--note", "Something got through");
  expect(r.status, r.stderr).toBe(0);
  expect(checkpointOf(repo)).toBe("near");
  expect(repo.rows("select kind from ladder where kind in ('escape', 'demoted')")).toEqual([
    { kind: "escape" },
  ]);
});
