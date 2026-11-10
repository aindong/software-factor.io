// An escape names a run, a lane the run went through, and what got through.
import { expect, it } from "vitest";
import { cleanRun, ladderRepo } from "../helpers/ladder.ts";

it("refuses an escape with no run, no such lane in the run, or no note, and records nothing", () => {
  const repo = ladderRepo();
  const run = cleanRun(repo);
  for (const [args, said] of [
    [["escape", "nothing-like-a-run", "--lane", "build", "--note", "x"], /nothing-like-a-run/],
    [["escape", run, "--lane", "review", "--note", "x"], /review/],
    [["escape", run, "--lane", "build"], /note/],
    [["escape", run, "--note", "x"], /lane/],
    [["escape"], /run/],
  ] as const) {
    const r = repo.sf(...args);
    expect(r.status, args.join(" ")).toBe(1);
    expect(r.stderr, args.join(" ")).toMatch(said);
  }
  expect(repo.rows("select count(*) as n from ladder where kind <> 'seen'")).toEqual([{ n: 0 }]);
});

it("refuses an escape for a run that has not ended, and a second one for the same run and lane", () => {
  const repo = ladderRepo();
  repo.sf("run"); // it waits
  const waiting = repo.rows<{ id: string }>("select id from runs")[0]?.id ?? "";
  const early = repo.sf("escape", waiting, "--lane", "build", "--note", "x");
  expect(early.status).toBe(1);
  expect(early.stderr).toMatch(/not ended/);
  repo.sf("approve", waiting);
  expect(repo.sf("escape", waiting, "--lane", "build", "--note", "x").status).toBe(0);
  const twice = repo.sf("escape", waiting, "--lane", "build", "--note", "x again");
  expect(twice.status).toBe(1);
  expect(twice.stderr).toMatch(/already recorded/);
  expect(repo.rows("select count(*) as n from ladder where kind = 'escape'")).toEqual([{ n: 1 }]);
});
