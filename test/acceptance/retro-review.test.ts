// From the correctness review of task 22.
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { cleanRun, ladderRepo } from "../helpers/ladder.ts";
import { commandLane, flowRepo, trail } from "../helpers/repo.ts";

it("does not call a retro drafted when the draft could not be written, and drafts again when the file is gone", () => {
  const repo = ladderRepo();
  repo.sf("escape", cleanRun(repo), "--lane", "build", "--note", "x");
  const dir = join(repo.dir, ".factor/retros");
  mkdirSync(dir);
  chmodSync(dir, 0o555);
  const refused = repo.sf("retro", "draft", "1");
  chmodSync(dir, 0o755);
  expect(refused.status).toBe(1);
  expect(refused.stdout).not.toMatch(/drafted:/);
  expect(repo.sf("retro").stdout).toMatch(/^1\s+open/m);
  const drafted = repo.sf("retro", "draft", "1");
  expect(drafted.stdout).toMatch(/drafted: (\S+)/);
  const path = /drafted: (\S+)/.exec(drafted.stdout)?.[1] ?? "";
  rmSync(join(repo.dir, path));
  expect(repo.sf("retro", "draft", "1").stdout).toMatch(/drafted:/);
  expect(repo.read(path)).toContain("## Why it got through");
});

it("does not fail a lane for a lesson a person committed, which the lane's branch took in from main", () => {
  const repo = flowRepo({
    lanes: [
      commandLane(
        "sync",
        // a person keeps a lesson on main while the run is going, and the lane merges main into its branch
        'mkdir -p "$ROOT/.factor/memory/lessons" && echo "# A lesson of the person" > "$ROOT/.factor/memory/lessons/l.md" && git -C "$ROOT" add -A && git -C "$ROOT" commit -q -m "a lesson" && git merge -q main',
        { gates: ["verify"] },
      ),
    ],
    factory: { gateEnv: ["ROOT"] },
  });
  repo.env.ROOT = repo.dir;
  const r = repo.sf("run");
  expect(trail(repo), r.stdout + r.stderr).toEqual(["sync:pass"]);
});

it("fails a lane whose change holds the machine's own bindings", () => {
  const repo = flowRepo({
    lanes: [
      commandLane(
        "sneak",
        'echo "{}" > .factor/local.json && git add -f .factor/local.json && git commit -q -m mine',
        {
          gates: ["verify"],
        },
      ),
    ],
  });
  repo.sf("run");
  expect(trail(repo)).toEqual(["sneak:fail"]);
});
