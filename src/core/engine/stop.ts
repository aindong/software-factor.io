// A person stops a run. A run that is working is asked through SQLite, and its own process stops
// what it is running. A run that waits, or whose process is gone, is ended here.
import { existsSync } from "node:fs";
import { MINUTE_MS } from "../clock.ts";
import { openDb } from "../db.ts";
import { UserError } from "../errors.ts";
import * as store from "../store.ts";
import type { Workspace } from "../workspace.ts";
import { cleanUp, isAlive } from "./recover.ts";
import type { RunState } from "./state.ts";

const WAIT_MS = 15_000;

// A stopped or dropped run's task goes back to queued; the run and its record stay as they are.
export function requeueRun(ws: Workspace, runId: string): string {
  const db = openDb(ws.dbPath);
  try {
    const run = store.getRun(db, runId);
    if (!run)
      throw new UserError(`There is no run "${runId}".`, "See the run ids with `softwarefactor status`.");
    const refuse = (why: string, fix: string) =>
      new UserError(`Run ${runId} cannot be requeued: ${why}.`, fix);
    if (run.status === "running") throw refuse("it is still working", "Stop it first, or wait.");
    if (run.status === "waiting")
      throw refuse("it is waiting for a person", "Decide on it, or stop it first.");
    if (run.status === "done") throw refuse("it ended done", "A task that is done needs no second try.");
    const task = store.getTask(db, run.task_id);
    if (task?.status === "queued")
      throw refuse("its task is already queued", "The next `softwarefactor run` takes it.");
    const taken = refuse("another run has taken its task since", "See `softwarefactor status`.");
    if (task?.status !== "stopped" && task?.status !== "dropped") throw taken;
    // one conditional write: a run in another process may take the task between the check and here
    const changed = db
      .prepare("update tasks set status = 'queued' where id = ? and status in ('stopped', 'dropped')")
      .run(run.task_id).changes;
    if (!changed) throw taken;
    return `run ${runId} requeued: the task "${task.title}" is queued, and the next softwarefactor run takes it.`;
  } finally {
    db.close();
  }
}

// A run that stopped on its budget is set back to work once the workflow allows more. Nothing is run
// again: the scheduler takes it up as it takes up a run whose process is gone, from the lane it had reached.
export function resumeRun(ws: Workspace, runId: string): string {
  const db = openDb(ws.dbPath);
  try {
    const run = store.getRun(db, runId);
    if (!run)
      throw new UserError(`There is no run "${runId}".`, "See the run ids with `softwarefactor status`.");
    const refuse = (why: string, fix: string) =>
      new UserError(`Run ${runId} cannot be carried on: ${why}.`, fix);
    const again = "`softwarefactor requeue` starts its task again from the beginning.";
    if (run.status !== "stopped")
      throw refuse(`it is ${run.status}`, "Only a run that stopped on its budget is carried on.");
    if (!/^budget_(minutes|tokens|usd)$/.test(run.stop_code ?? ""))
      throw refuse(`it did not stop on its budget (${run.stop_code})`, again);
    const state = JSON.parse(run.state) as RunState;
    const limits = ws.workflow.limits;
    const used = [
      state.spent.ms >= limits.minutes * MINUTE_MS ? "minutes" : "",
      state.spent.tokens >= limits.tokens ? "tokens" : "",
      limits.usd !== undefined && state.spent.usd >= limits.usd ? "usd" : "",
    ].filter(Boolean);
    if (used.length > 0)
      throw refuse(
        "its budget is still used up",
        `Raise ${used.map((u) => `limits.${u}`).join(" and ")} in the workflow first.`,
      );
    if (store.getTask(db, run.task_id)?.status !== "stopped")
      throw refuse("another run has taken its task since", "See `softwarefactor status`.");
    if (!existsSync(run.worktree)) throw refuse("its worktree is gone", again);
    // one conditional write: the run is working again, with no process, so the scheduler takes it up
    const changed = db
      .prepare(
        "update runs set status = 'running', stop_code = null, stop_reason = null, ended_at = null, pid = null where id = ? and status = 'stopped'",
      )
      .run(runId).changes;
    if (!changed) throw refuse("it was moved by another process just now", "See `softwarefactor status`.");
    store.setTaskStatus(db, run.task_id, "running");
    store.addEvent(db, runId, "run.resumed", { from: state.next });
    return `run ${runId}: carries on from lane "${state.next}"`;
  } finally {
    db.close();
  }
}

export async function stopRun(ws: Workspace, runId: string): Promise<string> {
  const db = openDb(ws.dbPath);
  try {
    const run = store.workingRuns(db).find((r) => r.id === runId) ?? store.getRun(db, runId);
    if (!run)
      throw new UserError(`There is no run "${runId}".`, "See the run ids with `softwarefactor status`.");
    if (run.status !== "running" && run.status !== "waiting") {
      throw new UserError(`Run ${runId} has already ended (${run.status}).`, "Nothing to stop.");
    }
    const end = (why: string) => {
      db.prepare(
        "update lane_runs set outcome = 'fail', note = ?, ended_at = ? where run_id = ? and outcome is null",
      ).run(why, new Date().toISOString(), runId);
      for (const item of store.openInbox(db).filter((i) => i.run_id === runId))
        store.closeInbox(db, item.id, "closed", why);
      store.endRun(db, runId, "stopped", "stopped_by_person", why);
      store.releaseSlot(db, runId);
      store.setTaskStatus(db, run.task_id, "stopped");
      store.addEvent(db, runId, "run.stopped", { code: "stopped_by_person" });
      return `run ${runId} stopped: ${why}`;
    };

    if (run.status === "waiting") {
      // take it first, so a decision or a wake in another process cannot move it at the same moment
      if (!store.takeWaitingRun(db, runId))
        throw new UserError(`Run ${runId} just started moving.`, "Run stop again.");
      return end("stopped by a person");
    }
    const pid = run.pid;
    if (!isAlive(pid)) {
      // take it first: a `run` in another process may be picking this orphan up right now
      if (!store.takeOrphan(db, runId, pid))
        throw new UserError(`Run ${runId} just started moving again.`, "Run stop again.");
      cleanUp(ws, runId);
      return end("stopped by a person, after its process had died");
    }
    store.requestStop(db, runId);
    for (let waited = 0; waited < WAIT_MS; waited += 200) {
      await new Promise((r) => setTimeout(r, 200));
      const now = store.getRun(db, runId);
      if (!now || now.status === "running") continue;
      if (now.status === "stopped")
        return `run ${runId} stopped: ${now.stop_reason ?? "stopped by a person"}`;
      // it parked on its own before it saw the request: end it here
      if (now.status === "waiting" && store.takeWaitingRun(db, runId)) return end("stopped by a person");
      return `run ${runId} had already ended (${now.status}) before it could be stopped`;
    }
    throw new UserError(
      `Run ${runId} did not stop within ${WAIT_MS / 1000} seconds.`,
      `Its process is ${pid}. Check it, then run stop again.`,
    );
  } finally {
    db.close();
  }
}
