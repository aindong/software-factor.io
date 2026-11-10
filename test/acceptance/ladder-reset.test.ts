// What breaks a run of clean runs, and what is not counted yet.
import { expect, it } from "vitest";
import { cleanRun, ladderLine, ladderRepo, lastRun } from "../helpers/ladder.ts";

it("starts the count again when the lane's work is sent back or rejected", () => {
  for (const decision of ["send-back", "reject"] as const) {
    const repo = ladderRepo();
    cleanRun(repo);
    expect(ladderLine(repo)).toMatch(/1 of 2/);
    repo.sf("run");
    const args =
      decision === "send-back"
        ? ["send-back", lastRun(repo).id, "--note", "say more"]
        : ["reject", lastRun(repo).id];
    expect(repo.sf(...args).status, decision).not.toBe(1);
    for (let i = 0; i < 4 && lastRun(repo).status === "waiting"; i += 1) repo.sf("approve", lastRun(repo).id);
    expect(ladderLine(repo), decision).toMatch(/0 of 2/);
    cleanRun(repo);
    expect(ladderLine(repo), decision).toMatch(/1 of 2/);
  }
});

it("does not count a run that still waits, and starts again when the lane fails", () => {
  const repo = ladderRepo();
  cleanRun(repo);
  repo.sf("run"); // it waits for approval
  expect(lastRun(repo).status).toBe("waiting");
  expect(ladderLine(repo)).toMatch(/1 of 2/);
  repo.sf("approve", lastRun(repo).id);
  expect(ladderLine(repo)).toMatch(/2 of 2/);
  // the gate now fails: the lane's work was not clean
  const factory = repo.json<{ commands: Record<string, string> }>(".factor/factory.json");
  repo.write(".factor/factory.json", JSON.stringify({ ...factory, commands: { verify: "false" } }));
  repo.sf("run");
  expect(lastRun(repo).status).toBe("stopped");
  expect(ladderLine(repo)).toMatch(/0 of 2/);
});
