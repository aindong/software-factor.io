// The ladder: a lane's record, and the suggestion it earns.
import { expect, it } from "vitest";
import { cleanRun, ladderLine, ladderRepo } from "../helpers/ladder.ts";
import { commandLane, flowRepo } from "../helpers/repo.ts";

it("suggests a step up after the runs asked for, and not one run sooner", () => {
  const repo = ladderRepo();
  expect(ladderLine(repo)).toMatch(/build\s+in the loop\s+0 of 2/);
  cleanRun(repo);
  expect(ladderLine(repo)).toMatch(/build\s+in the loop\s+1 of 2/);
  expect(repo.sf("ladder").stdout).not.toMatch(/can move/);
  cleanRun(repo);
  expect(ladderLine(repo)).toMatch(/build\s+in the loop\s+2 of 2.*can move near the loop/);
  expect(repo.sf("ladder").stdout).toContain("softwarefactor ladder accept build");
  // the command lane is out of the loop already: it has nowhere to go
  expect(ladderLine(repo, "ship")).toMatch(/ship\s+out of the loop/);
  expect(ladderLine(repo, "ship")).not.toMatch(/can move/);
});

it("asks for 10 runs unless the workspace says otherwise", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true", { checkpoint: "in" })] });
  expect(repo.sf("ladder").stdout).toMatch(/build\s+in the loop\s+0 of 10/);
});
