// `softwarefactor requeue <run>` puts the task of a stopped or dropped run back in the queue.

import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { agentLane, background, fail, flowRepo, pass, type Repo, runRow, until } from "../helpers/repo.ts";

/** A repository whose one task has been through one run that ended the way the lane says. */
function ended(lane: Record<string, unknown> = {}) {
  const repo = flowRepo({
    lanes: [agentLane("work", lane)],
    scripts: { author: { work: [fail("no")] } },
  });
  repo.sf("run");
  return repo;
}
const tasks = (repo: Repo) => repo.rows<{ status: string }>("select status from tasks");
const runs = (repo: Repo) => repo.rows<{ id: string; status: string; branch: string }>("select * from runs");
/** A refusal in the factory's own words: exit 1 and an "error:" line, not the help for an unknown command. */
const refused = (r: { status: number | null; stderr: string }, said: RegExp) => {
  expect(r.status).toBe(1);
  expect(r.stderr).not.toContain("Unknown command");
  expect(r.stderr).toMatch(/^error: /m);
  expect(r.stderr).toMatch(said);
};
const record = (repo: Repo, id: string) => ({
  run: repo.rows(`select * from runs where id = '${id}'`),
  lanes: repo.rows(`select * from lane_runs where run_id = '${id}' order by id`),
});

describe("softwarefactor requeue", () => {
  it("sets the task of a stopped run back to queued, and the next run takes it on a new branch", () => {
    const repo = ended();
    const [first] = runs(repo);
    expect(first).toMatchObject({ status: "stopped" });
    const before = record(repo, first?.id ?? "");
    const r = repo.sf("requeue", first?.id ?? "");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain(first?.id);
    expect(r.stdout).toMatch(/requeued/);
    expect(tasks(repo)).toEqual([{ status: "queued" }]);
    // the old run and its record stay as they are
    expect(record(repo, first?.id ?? "")).toEqual(before);

    repo.sf("run");
    const all = runs(repo);
    expect(all).toHaveLength(2);
    const second = all.find((x) => x.id !== first?.id);
    expect(second?.branch).not.toBe(first?.branch);
    expect(record(repo, first?.id ?? "")).toEqual(before);
    expect(repo.rows("select id from tasks")).toHaveLength(1);
  });

  it("does the same for a dropped run", () => {
    const repo = ended({ on: { pass: "@done", fail: "@drop" } });
    const [first] = runs(repo);
    expect(first).toMatchObject({ status: "dropped" });
    expect(tasks(repo)).toEqual([{ status: "dropped" }]);
    const r = repo.sf("requeue", first?.id ?? "");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(tasks(repo)).toEqual([{ status: "queued" }]);
    expect(runs(repo)).toEqual([first]);
  });

  it("refuses a task that is already queued, with exit 1", () => {
    const repo = ended();
    const id = runs(repo)[0]?.id ?? "";
    expect(repo.sf("requeue", id).status).toBe(0);
    const again = repo.sf("requeue", id);
    refused(again, /already queued/);
    expect(tasks(repo)).toEqual([{ status: "queued" }]);
  });

  it("refuses a run that is waiting for a person", () => {
    const repo = flowRepo({ lanes: [agentLane("work", { checkpoint: "in" })] });
    expect(repo.sf("run").status).toBe(3);
    const r = repo.sf("requeue", runRow(repo)?.id ?? "");
    refused(r, /waiting/);
    expect(tasks(repo)).toEqual([{ status: "waiting" }]);
  });

  it("refuses a run that is still working", async () => {
    const repo = flowRepo({
      lanes: [agentLane("work")],
      scripts: { author: { work: [{ sleep: 60_000 }, pass()] } },
    });
    const working = background(repo, "run");
    expect(await until(() => repo.rows("select id from lane_runs").length === 1)).toBe(true);
    const r = repo.sf("requeue", runRow(repo)?.id ?? "");
    refused(r, /still working/);
    expect(tasks(repo)).toEqual([{ status: "running" }]);
    repo.sf("stop", runRow(repo)?.id ?? "");
    await working.exit;
  }, 30_000);

  it("refuses a run that ended done", () => {
    const repo = flowRepo({ lanes: [agentLane("work")] });
    expect(repo.sf("run").status).toBe(0);
    const r = repo.sf("requeue", runRow(repo)?.id ?? "");
    refused(r, /done/);
    expect(tasks(repo)).toEqual([{ status: "done" }]);
  });

  it("refuses a stopped run whose task another run has taken since", () => {
    const repo = ended();
    const id = runs(repo)[0]?.id ?? "";
    const db = new DatabaseSync(join(repo.dir, ".factor/state.db"));
    db.exec("update tasks set status = 'running'");
    db.close();
    const r = repo.sf("requeue", id);
    refused(r, /another run/);
    expect(tasks(repo)).toEqual([{ status: "running" }]);
  });

  it("refuses a run it does not know, and a missing run id", () => {
    const repo = ended();
    const unknown = repo.sf("requeue", "nosuchrun");
    refused(unknown, /There is no run "nosuchrun"/);
    const none = repo.sf("requeue");
    refused(none, /needs a run id/);
    expect(tasks(repo)).toEqual([{ status: "stopped" }]);
  });

  it("is refused inside a run, like the other commands that change the factory", () => {
    const repo = ended();
    repo.env.FACTOR_RUN_ID = "abcd1234";
    const r = repo.sf("requeue", runs(repo)[0]?.id ?? "");
    delete repo.env.FACTOR_RUN_ID;
    refused(r, /inside a run/);
    expect(tasks(repo)).toEqual([{ status: "stopped" }]);
  });
});
