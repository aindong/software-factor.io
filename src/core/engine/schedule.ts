// Which runs move in one call of the command: runs a dead process left, waits that are due, and
// queued tasks, as many at once as there are free slots.

import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { openDb } from "../db.ts";
import { saveRunFile } from "../evidence.ts";
import { wasInterrupted } from "../exec.ts";
import { addWorktree, headOf } from "../git.ts";
import * as store from "../store.ts";
import type { Workspace } from "../workspace.ts";
import type { Ctx } from "./lane.ts";
import { preflight } from "./preflight.ts";
import { recoverOrphans } from "./recover.ts";
import { advance, collect, contextFor, finish, type RunSummary } from "./run.ts";
import { installSkills } from "./skills.ts";
import { maxSlots } from "./slots.ts";
import { newState } from "./state.ts";

export interface RunOptions {
  /** Keep going until nothing is queued and no wait is due. Without it, one new task is started. */
  all?: boolean;
  /** How many runs may work at once in this call. Never more than the workspace's slots. */
  parallel?: number;
}

/**
 * Pick up runs a dead process left, wake the waits that are due, and take queued tasks through the
 * workflow, as many at once as there are free slots.
 */
export async function runNext(ws: Workspace, options: RunOptions = {}): Promise<RunSummary> {
  preflight(ws);
  const db = openDb(ws.dbPath);
  const log: string[] = [];
  try {
    const slots = maxSlots(ws);
    // one run at a time unless the call asks for more
    const cap = Math.max(1, Math.min(slots, options.parallel ?? (options.all ? slots : 1)));
    // one call can move several runs: report the worst outcome among them
    const rank = { none: 0, running: 0, done: 1, dropped: 1, waiting: 2, stopped: 3 } as const;
    let worst: RunSummary | undefined;
    const seen = (summary: RunSummary) => {
      if (!worst || rank[summary.status] > rank[worst.status]) worst = summary;
    };

    const endedByCrash: string[] = [];
    const orphans = recoverOrphans(ws, db, log, endedByCrash);
    for (const id of endedByCrash) seen({ status: "stopped", runId: id, code: "crashed", log });
    // a run this call has already moved is not woken again by the same call
    const moved = new Set<string>();
    const [count = "", ...said] = collect(ws, db);
    if (!count.startsWith("collected 0 ")) log.push(count);
    log.push(...said);
    let started = 0;
    let busy = false;

    /** The next run this call can move, with a slot claimed for it, or nothing. */
    const next = (): Ctx | undefined => {
      for (const run of orphans.splice(0, 1)) {
        if (store.claimSlot(db, run.id, slots) === undefined) {
          orphans.unshift(run);
          busy = true;
          return undefined;
        }
        return contextFor(ws, db, run, log);
      }
      for (const due of store.dueRuns(db)) {
        if (moved.has(due.id)) continue;
        if (!store.takeWaitingRun(db, due.id)) continue; // another process woke it first
        if (store.claimSlot(db, due.id, slots) === undefined) {
          store.endRun(
            db,
            due.id,
            "waiting",
            due.stop_code ?? "waiting",
            due.stop_reason ?? "waiting",
            due.wake_at,
          ); // park it again, as it was
          busy = true;
          return undefined;
        }
        store.setTaskStatus(db, due.task_id, "running");
        log.push(`run ${due.id}: waking`);
        return contextFor(ws, db, { ...due, status: "running" }, log);
      }
      if (!options.all && started >= 1) return undefined;
      const queued = db.prepare("select count(*) as n from tasks where status = 'queued'").get() as {
        n: number;
      };
      if (queued.n === 0) return undefined;
      // the slot is claimed first, so a task is never taken by a run that cannot start
      const runId = randomBytes(4).toString("hex");
      const slot = store.claimSlot(db, runId, slots);
      if (slot === undefined) {
        busy = true;
        return undefined;
      }
      const task = store.claimNextTask(db);
      if (!task) {
        store.releaseSlot(db, runId); // another process took the last task
        return undefined;
      }
      // the key is whatever the collector found (a time, an id from a server): only its letters and digits name the branch
      const slug = task.key
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
      const branch = `factor/${slug || "task"}-${runId}`;
      const worktree = join(ws.workDir, runId);
      const first = ws.workflow.lanes[0]?.id ?? "";
      let base: string;
      try {
        base = headOf(ws.root);
        store.createRun(db, {
          id: runId,
          task_id: task.id,
          workflow: ws.workflow.name,
          base_commit: base,
          branch,
          worktree,
          state: JSON.stringify(newState(first)),
        });
        db.prepare("update runs set slot = ? where id = ?").run(slot, runId);
      } catch (error) {
        store.releaseSlot(db, runId);
        store.setTaskStatus(db, task.id, "queued"); // nothing started: the task goes back in the queue
        throw error;
      }
      started += 1;
      // The workflow this process loaded is kept with the run: a run is later shown on what it ran
      // on, and not on whatever the file has become since.
      try {
        saveRunFile(ws, runId, "", "workflow.json", ws.workflowText);
      } catch {
        // without it the run is shown on the workflow as it is when it is looked at, and says so
      }
      store.addEvent(db, runId, "run.started", { task: task.title });
      log.push(`run ${runId}: ${task.title}`);
      const run = store.getRun(db, runId);
      if (!run) throw new Error("the run was not recorded");
      const ctx = contextFor(ws, db, run, log);
      try {
        addWorktree(ws.root, worktree, branch, base);
        installSkills(ws, worktree);
      } catch (error) {
        seen(finish(ctx, "stopped", "crashed", `the run could not start: ${(error as Error).message}`));
        return next();
      }
      return ctx;
    };

    const active = new Set<Promise<void>>();
    let failure: unknown;
    try {
      for (;;) {
        while (active.size < cap && !wasInterrupted() && failure === undefined) {
          const ctx = next();
          if (!ctx) break;
          moved.add(ctx.run.id);
          const moving: Promise<void> = advance(ctx)
            .then(seen, (error) => {
              failure ??= error;
            })
            .finally(() => active.delete(moving));
          active.add(moving);
        }
        if (active.size === 0) break;
        await Promise.race(active);
      }
    } finally {
      // the database is closed below: nothing may still be using it
      await Promise.allSettled(active);
    }
    if (failure !== undefined) throw failure;
    if (busy && !worst) log.push(`every slot is busy (${slots} in all): nothing was started`);
    return worst
      ? { ...(worst as RunSummary), log }
      : { status: "none", log: busy ? log : [...log, "no queued task"] };
  } finally {
    db.close();
  }
}
