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
  expect(repo.rows("select count(*) as n from ladder")).toEqual([{ n: 0 }]);
});
