import { describe, expect, it } from "vitest";
import {
  agentLane,
  alive,
  background,
  commandLane,
  flowRepo,
  pass,
  runRow,
  trail,
  uniqueNap,
  until,
} from "../helpers/repo.ts";

describe("softwarefactor stop", () => {
  it("stops an agent that is working in another process", async () => {
    const repo = flowRepo({
      lanes: [agentLane("work")],
      scripts: { author: { work: [{ sleep: 60_000 }, pass()] } },
    });
    const run = background(repo, "run");
    expect(await until(() => repo.rows("select id from lane_runs").length === 1)).toBe(true);
    const started = Date.now();
    const stop = repo.sf("stop", runRow(repo)?.id ?? "");
    expect(stop.status, stop.stdout + stop.stderr).toBe(0);
    expect(await run.exit).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(8000);
    expect(runRow(repo)).toMatchObject({ status: "stopped", stop_code: "stopped_by_person" });
    expect(trail(repo)).toEqual(["work:fail"]);
    expect(repo.rows("select run_id from slots")).toEqual([]);
  }, 30_000);

  it("stops a command that is running in another process", async () => {
    const nap = uniqueNap(60);
    const repo = flowRepo({ lanes: [commandLane("work", nap)] });
    const run = background(repo, "run");
    expect(await until(() => alive(nap))).toBe(true);
    expect(repo.sf("stop", runRow(repo)?.id ?? "").status).toBe(0);
    await run.exit;
    expect(alive(nap)).toBe(false);
    expect(runRow(repo)).toMatchObject({ status: "stopped", stop_code: "stopped_by_person" });
  }, 30_000);

  it("ends a run that waits for a person, and closes its inbox item", () => {
    const repo = flowRepo({ lanes: [agentLane("work", { checkpoint: "in" })] });
    expect(repo.sf("run").status).toBe(3);
    expect(repo.sf("stop", runRow(repo)?.id ?? "").status).toBe(0);
    expect(runRow(repo)).toMatchObject({ status: "stopped", stop_code: "stopped_by_person" });
    expect(repo.rows("select status from inbox")).toEqual([{ status: "closed" }]);
    expect(repo.rows("select status from tasks")).toEqual([{ status: "stopped" }]);
  });

  it("refuses a run that has already ended", () => {
    const repo = flowRepo({ lanes: [agentLane("work")] });
    repo.sf("run");
    const r = repo.sf("stop", runRow(repo)?.id ?? "");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/already/);
  });
});
