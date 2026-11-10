// Picks up runs whose process died. A run is an orphan when it says "running" but the process that
// owned it is gone. Its leftover commands are stopped, its gate checkouts removed, the lane that was
// cut off is recorded, and the run is handed back to be continued from that lane.
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../db.ts";
import { git, removeWorktree } from "../git.ts";
import * as store from "../store.ts";
import type { Workspace } from "../workspace.ts";
import type { RunState } from "./state.ts";

const isAlive = (pid: number | null): boolean => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Stop the commands a dead process left, and remove the checkouts its gates were using. */
export function cleanUp(ws: Workspace, runId: string): void {
  const pidFile = join(ws.workDir, `${runId}.out`, "pids");
  if (existsSync(pidFile)) {
    for (const line of readFileSync(pidFile, "utf8").split("\n")) {
      const pid = Number(line);
      if (pid > 1) {
        try {
          process.kill(-pid, "SIGKILL"); // each command ran in its own group
        } catch {
          // already gone
        }
      }
    }
    rmSync(pidFile, { force: true });
  }
  if (existsSync(ws.workDir)) {
    for (const entry of readdirSync(ws.workDir)) {
      if (entry.startsWith(`${runId}-gate-`)) removeWorktree(ws.root, join(ws.workDir, entry));
    }
  }
  try {
    git(ws.root, "worktree", "prune");
  } catch {
    // nothing to prune
  }
}

/** Take over every orphaned run. Each returned run is this process's to continue. */
export function recoverOrphans(ws: Workspace, db: Db, log: string[]): store.Run[] {
  const taken: store.Run[] = [];
  for (const run of store.workingRuns(db)) {
    if (run.pid === process.pid || isAlive(run.pid)) continue;
    if (!store.takeOrphan(db, run.id, run.pid)) continue; // another process is recovering it
    cleanUp(ws, run.id);
    store.releaseSlot(db, run.id);
    db.prepare(
      "update lane_runs set outcome = 'fail', note = 'cut off by a crash of the factory', ended_at = ? where run_id = ? and outcome is null",
    ).run(new Date().toISOString(), run.id);
    // continue from the lane that was cut off, as a new entry to it
    const state = JSON.parse(run.state) as RunState;
    state.parked = undefined;
    state.seq += 1;
    store.saveState(db, run.id, state);
    store.addEvent(db, run.id, "run.recovered", { deadPid: run.pid });
    log.push(`run ${run.id}: its process died. Picking it up after the crash, from lane "${state.next}"`);
    const fresh = store.getRun(db, run.id);
    if (fresh) taken.push(fresh);
  }
  return taken;
}

export { isAlive };
