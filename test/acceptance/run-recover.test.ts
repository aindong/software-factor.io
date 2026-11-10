import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentLane,
  alive,
  background,
  commitFile,
  flowRepo,
  pass,
  runRow,
  trail,
  uniqueNap,
  until,
} from "../helpers/repo.ts";

describe("a run whose process died", () => {
  it("is picked up by the next run: leftovers cleaned, the cut-off lane recorded, the run finished", async () => {
    const nap = uniqueNap(60);
    // the gate hangs the first time and passes the second
    const repo = flowRepo({
      commands: { verify: `test -f "$FLAG" || { touch "$FLAG"; ${nap}; }` },
      lanes: [agentLane("build", { agent: { access: "write" }, gates: ["verify"] })],
      scripts: { author: { build: [[...commitFile("a.txt"), pass()], [pass()]] } },
      factory: { gateEnv: ["FLAG"] },
    });
    repo.env.FLAG = join(repo.home, "flag");

    const run = background(repo, "run");
    expect(await until(() => alive(nap))).toBe(true);
    run.child.kill("SIGKILL");
    await run.exit;
    expect(runRow(repo)?.status).toBe("running"); // nobody ended it: its process is gone
    expect(alive(nap)).toBe(true); // and the gate's command was left behind

    const next = repo.sf("run");
    expect(next.status, next.stdout + next.stderr).toBe(0);
    expect(next.stdout).toMatch(/crash/);
    expect(alive(nap)).toBe(false);
    expect(repo.git("worktree", "list")).not.toMatch(/-gate-/);
    expect(trail(repo)).toEqual(["build:fail", "build:pass"]);
    expect(repo.rows<{ note: string }>("select note from lane_runs order by id")[0]?.note).toMatch(/crash/);
    expect(runRow(repo)).toMatchObject({ status: "done", stop_code: "done" });
    expect(repo.rows("select run_id from slots")).toEqual([]);
  }, 40_000);

  it("is left alone while its process is alive", async () => {
    const repo = flowRepo({
      lanes: [agentLane("work")],
      scripts: { author: { work: [{ sleep: 3000 }, pass()] } },
      factory: { slots: { max: 2 } },
    });
    const run = background(repo, "run");
    expect(await until(() => repo.rows("select id from lane_runs").length === 1)).toBe(true);
    const other = repo.sf("run");
    expect(other.stdout).not.toMatch(/crash/);
    expect(await run.exit).toBe(0);
    expect(trail(repo)).toEqual(["work:pass"]);
  }, 30_000);
});
