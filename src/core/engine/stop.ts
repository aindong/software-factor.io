// A person stops a run. A run that is working is asked through SQLite, and its own process stops
// what it is running. A run that waits, or whose process is gone, is ended here.
import { openDb } from "../db.ts";
import { UserError } from "../errors.ts";
import * as store from "../store.ts";
import type { Workspace } from "../workspace.ts";
import { cleanUp, isAlive } from "./recover.ts";

const WAIT_MS = 15_000;

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
