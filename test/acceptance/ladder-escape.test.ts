// A defect that got through a lane moves the lane a step back at once.
import { expect, it } from "vitest";
import { checkpointOf, cleanRun, ladderLine, ladderRepo, lastRun } from "../helpers/ladder.ts";

it("moves a lane near the loop back in the loop, records why, and the lane waits again", () => {
  const repo = ladderRepo();
  cleanRun(repo);
  cleanRun(repo);
  expect(repo.sf("ladder", "accept", "build").status).toBe(0);
  const escaped = cleanRun(repo); // near the loop: nobody looked, and something got through
  const r = repo.sf("escape", escaped, "--lane", "build", "--note", "The export button was left out");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toMatch(/build is back in the loop/);
  expect(checkpointOf(repo)).toBe("in");
  expect(repo.sf("check").status).toBe(0);
  expect(
    repo.rows(
      "select lane, kind, from_mode, to_mode, run_id, note from ladder where kind <> 'promoted' order by id",
    ),
  ).toEqual([
    {
      lane: "build",
      kind: "escape",
      from_mode: null,
      to_mode: null,
      run_id: escaped,
      note: "The export button was left out",
    },
    {
      lane: "build",
      kind: "demoted",
      from_mode: "near",
      to_mode: "in",
      run_id: escaped,
      note: "The export button was left out",
    },
  ]);
  expect(ladderLine(repo)).toMatch(/build\s+in the loop\s+0 of 2/);
  expect(ladderLine(repo)).toMatch(
    /moved back in the loop on \d{4}-\d{2}-\d{2}.*The export button was left out/,
  );
  repo.sf("run");
  expect(lastRun(repo).status).toBe("waiting");
});

it("records an escape at a lane already in the loop, moves nothing, and starts its count again", () => {
  const repo = ladderRepo();
  const first = cleanRun(repo);
  expect(ladderLine(repo)).toMatch(/1 of 2/);
  const r = repo.sf("escape", first, "--lane", "build", "--note", "A typo in the title");
  expect(r.status, r.stderr).toBe(0);
  expect(checkpointOf(repo)).toBe("in");
  expect(repo.rows("select kind from ladder")).toEqual([{ kind: "escape" }]);
  expect(ladderLine(repo)).toMatch(/0 of 2/);
});
