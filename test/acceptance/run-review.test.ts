import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { hostEnv, sh } from "../../src/core/exec.ts";
import {
  agentLane,
  alive,
  background,
  commandLane,
  flowRepo,
  runRow,
  trail,
  uniqueNap,
  until,
} from "../helpers/repo.ts";

// Found by the correctness review of slots, stop and recovery.
const waitUntil = (run: string, extra: Record<string, unknown> = {}) => ({
  id: "pause",
  uses: "core/wait@1",
  with: { until: { run }, everyMinutes: 1, timeoutHours: 1 },
  checkpoint: "out",
  on: { pass: "@done", fail: "@stop" },
  ...extra,
});

describe("stopping", () => {
  it("ends a run that is in the middle of a wait lane's check", async () => {
    const nap = uniqueNap(60);
    const repo = flowRepo({ lanes: [waitUntil(nap)] });
    const run = background(repo, "run");
    expect(await until(() => alive(nap))).toBe(true);
    expect(repo.sf("stop", runRow(repo)?.id ?? "").status).toBe(0);
    await run.exit;
    expect(runRow(repo)).toMatchObject({ status: "stopped", stop_code: "stopped_by_person" });
    expect(trail(repo)).toEqual(["pause:fail"]);
  }, 30_000);

  it("never signals a command that has already ended", async () => {
    const stop = new AbortController();
    await sh("true", { cwd: tmpdir(), env: hostEnv(), timeoutMs: 5000, signal: stop.signal });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    stop.abort();
    expect(kill).not.toHaveBeenCalled();
    kill.mockRestore();
  });

  it("keeps in the pids file only commands that are still running", async () => {
    const pidFile = join(tmpdir(), `sf-pids-${process.pid}-${Date.now()}`);
    await sh("true", { cwd: tmpdir(), env: hostEnv(), timeoutMs: 5000, pidFile });
    expect(existsSync(pidFile) ? readFileSync(pidFile, "utf8").trim() : "").toBe("");
  });
});

describe("waiting", () => {
  it("does not check again at once when the check itself took longer than the interval", () => {
    const repo = flowRepo({ lanes: [waitUntil("sleep 2; false")] });
    repo.env.FACTOR_MINUTE_MS = "1000"; // a minute lasts one second, so the 2 s check outlasts the interval
    const started = Date.now();
    expect(repo.sf("run").status).toBe(3);
    expect(Date.now() - started).toBeLessThan(8000);
    expect(runRow(repo)).toMatchObject({ status: "waiting", stop_code: "waiting" });
  }, 30_000);
});

describe("after a crash", () => {
  it("does not run a one-way lane a second time on its own", async () => {
    const nap = uniqueNap(60);
    const repo = flowRepo({
      lanes: [
        agentLane("build", { on: { pass: "deploy", fail: "@stop" } }),
        commandLane("deploy", nap, {
          oneWay: true,
          checkpoint: "in",
          on: { pass: "@done", fail: "@stop", needsPerson: "@stop" },
        }),
      ],
    });
    expect(repo.sf("run").status).toBe(3);
    const approve = background(repo, "approve", runRow(repo)?.id ?? "");
    expect(await until(() => alive(nap))).toBe(true);
    approve.child.kill("SIGKILL");
    await approve.exit;

    const next = repo.sf("run");
    expect(next.status).toBe(1);
    expect(alive(nap)).toBe(false);
    expect(runRow(repo)).toMatchObject({ status: "stopped", stop_code: "crashed" });
    expect(repo.rows<{ stop_reason: string }>("select stop_reason from runs")[0]?.stop_reason).toMatch(
      /one-way/,
    );
    expect(trail(repo)).toEqual(["build:pass", "deploy:fail"]);
  }, 40_000);

  it("a decision is not blocked by a slot whose holder died", async () => {
    const nap = uniqueNap(60);
    const repo = flowRepo({
      tasks: "- [ ] A\n- [ ] B\n",
      lanes: [commandLane("work", `test "$FACTOR_TASK_TITLE" = A || ${nap}`, { checkpoint: "in" })],
      factory: { slots: { max: 1 } },
    });
    expect(repo.sf("run").status).toBe(3); // A waits for approval
    repo.sf("run"); // B waits too
    const b =
      repo.rows<{ id: string }>(
        "select runs.id from runs join tasks on tasks.id = runs.task_id where tasks.title = 'B'",
      )[0]?.id ?? "";
    const working = background(repo, "approve", b);
    expect(await until(() => alive(nap))).toBe(true);
    working.child.kill("SIGKILL");
    await working.exit;
    const a =
      repo.rows<{ id: string }>(
        "select runs.id from runs join tasks on tasks.id = runs.task_id where tasks.title = 'A'",
      )[0]?.id ?? "";
    const r = repo.sf("approve", a);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    spawnKill(nap);
  }, 40_000);
});

/** Clean up the command the killed process left, so the test leaves nothing behind. */
function spawnKill(name: string) {
  // biome-ignore lint/style/noCommonJs: a one-line clean-up
  require("node:child_process").spawnSync("pkill", ["-f", name]);
}
