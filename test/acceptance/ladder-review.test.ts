// From the correctness review of task 21.
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkpointOf, cleanRun, ladderLine, ladderRepo, lastRun } from "../helpers/ladder.ts";

it("moves the lane in the file the workspace runs, not the file of the workflow's name", () => {
  const repo = ladderRepo();
  repo.write(".factor/workflows/variant.json", repo.read(".factor/workflows/starter.json"));
  const factory = repo.json(".factor/factory.json");
  repo.write(".factor/factory.json", `${JSON.stringify({ ...factory, workflow: "variant" }, null, 2)}\n`);
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "a variant");
  cleanRun(repo);
  cleanRun(repo);
  const r = repo.sf("ladder", "accept", "build");
  expect(r.status, r.stderr).toBe(0);
  const at = (file: string) =>
    repo.json<{ lanes: { id: string; checkpoint: string }[] }>(file).lanes.find((l) => l.id === "build")
      ?.checkpoint;
  expect(at(".factor/workflows/variant.json")).toBe("near");
  expect(at(".factor/workflows/starter.json")).toBe("in");
});

it("an escape whose step back could not be written can be reported again", () => {
  const repo = ladderRepo();
  cleanRun(repo);
  cleanRun(repo);
  expect(repo.sf("ladder", "accept", "build").status).toBe(0);
  const escaped = cleanRun(repo);
  const folder = join(repo.dir, ".factor/workflows");
  chmodSync(folder, 0o555);
  const first = repo.sf("escape", escaped, "--lane", "build", "--note", "It got through");
  chmodSync(folder, 0o755);
  expect(first.status).not.toBe(0);
  const again = repo.sf("escape", escaped, "--lane", "build", "--note", "It got through");
  expect(again.stderr).toBe("");
  expect(checkpointOf(repo)).toBe("in");
  expect(repo.rows("select kind from ladder where kind in ('escape', 'demoted') order by id")).toEqual([
    { kind: "escape" },
    { kind: "demoted" },
  ]);
});

it("does not hold a run that a person stopped against the lane it stood at", () => {
  const repo = ladderRepo();
  cleanRun(repo);
  expect(ladderLine(repo)).toMatch(/1 of 2/);
  repo.sf("run"); // it waits at build
  const stopped = repo.sf("stop", lastRun(repo).id);
  expect(lastRun(repo).status, stopped.stdout + stopped.stderr).toBe("stopped");
  expect(ladderLine(repo)).toMatch(/1 of 2/);
  cleanRun(repo);
  expect(ladderLine(repo)).toMatch(/2 of 2/);
});
