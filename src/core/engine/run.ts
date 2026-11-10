// A run from claim to end. The engine owns the state machine: it decides which lane is next, counts
// rounds, parks a run that waits for a person or a clock, and names every way a run can end (ADR 0013).
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { MINUTE_MS, nowMs } from "../clock.ts";
import { collectFile } from "../collectors/file.ts";
import { type Db, openDb } from "../db.ts";
import { UserError } from "../errors.ts";
import { hostEnv, sh, wasInterrupted } from "../exec.ts";
import { resolveCommand } from "../gates/command.ts";
import { addWorktree, branchTip, git, headOf, removeWorktree } from "../git.ts";
import type { WaitSettings } from "../schema/builtins.ts";
import type { Lane } from "../schema/workflow.ts";
import * as store from "../store.ts";
import type { Workspace } from "../workspace.ts";
import { type Ctx, runLane } from "./lane.ts";
import { preflight } from "./preflight.ts";
import { addNote, newState, type Parked, type RunState, type StopCode } from "./state.ts";
import { tierOf } from "./tier.ts";
import { choose, type Facts } from "./transition.ts";

export interface RunSummary {
  status: "none" | store.RunStatus;
  runId?: string;
  code?: string;
  reason?: string;
  /** One line per thing that happened, for the command line. */
  log: string[];
}

/** Ask every collector for tasks and add the new ones to the queue. Returns how many were new. */
export function collect(ws: Workspace, db: Db): number {
  let added = 0;
  for (const c of ws.workflow.collectors) {
    if (c.uses !== "core/file@1") continue;
    for (const draft of collectFile(ws.root, c.with as { path: string })) {
      if (store.addTask(db, { collector: c.id, ...draft })) added += 1;
    }
  }
  return added;
}

export function contextFor(ws: Workspace, db: Db, run: store.Run, log: string[]): Ctx {
  const task = store.getTask(db, run.task_id);
  if (!task) throw new Error(`run ${run.id} has no task`);
  const state = JSON.parse(run.state) as RunState;
  const ctx: Ctx = {
    ws,
    db,
    run,
    task,
    state,
    outDir: join(ws.workDir, `${run.id}.out`),
    log,
    facts: (): Facts => {
      let files: string[] = [];
      try {
        files = git(ws.root, "diff", "--name-only", run.base_commit, branchTip(ws.root, run.branch))
          .split("\n")
          .filter(Boolean);
      } catch {
        // no branch yet: nothing has changed
      }
      return {
        source: task.collector,
        labels: [],
        tier: tierOf(files),
        outputs: state.outputs,
        gates: state.gates,
      };
    },
  };
  return ctx;
}

function finish(
  ctx: Ctx,
  status: store.RunStatus,
  code: StopCode,
  reason: string,
  wakeAt: string | null = null,
): RunSummary {
  const { ws, db, run, state } = ctx;
  store.saveState(db, run.id, state);
  store.endRun(db, run.id, status, code, reason, wakeAt);
  store.setTaskStatus(db, ctx.task.id, status === "running" ? "running" : status);
  store.addEvent(db, run.id, `run.${status}`, { code, reason });
  if (status === "done" || status === "dropped") {
    removeWorktree(ws.root, run.worktree);
    rmSync(ctx.outDir, { recursive: true, force: true });
  }
  ctx.log.push(`run ${run.id} ${status}: ${reason}`);
  return { status, runId: run.id, code, reason, log: ctx.log };
}

/** Stop here and wait: for a person, or for a clock. The state says how to carry on. */
function park(
  ctx: Ctx,
  parked: Parked,
  code: StopCode,
  reason: string,
  inbox?: { kind: "approval" | "question"; body: string },
): RunSummary {
  ctx.state.parked = parked;
  if (inbox) store.addInbox(ctx.db, ctx.run.id, parked.lane, inbox.kind, inbox.body);
  const wakeAt =
    parked.kind === "wait" ? new Date(parked.nextCheck ?? parked.deadline ?? nowMs()).toISOString() : null;
  return finish(ctx, "waiting", code, reason, wakeAt);
}

/** Take the transition for a lane's outcome: move to the next lane, or end or park the run. Returns a summary when the run stops moving. */
export function applyOutcome(
  ctx: Ctx,
  lane: Lane,
  outcome: store.Outcome,
  note: string,
): RunSummary | undefined {
  const { ws, state, run } = ctx;
  const choice = choose(lane, outcome, ctx.facts(), state.rounds);
  const head = branchTip(ws.root, run.branch);
  const said = `lane "${lane.id}" ended ${outcome}${note ? `: ${note}` : ""}`;
  if (choice.key) {
    const target = ws.workflow.lanes.find((l) => l.id === choice.to);
    // a round that brought no new commit from a lane that writes is a loop going nowhere
    if (target?.agent?.access === "write" && state.loopHeads[choice.key] === head) {
      return finish(
        ctx,
        "stopped",
        "no_progress",
        `${said}, and "${choice.to}" made no new commit in the last round`,
      );
    }
    state.rounds[choice.key] = (state.rounds[choice.key] ?? 0) + 1;
    state.loopHeads[choice.key] = head;
  }
  if (choice.to === "@done") return finish(ctx, "done", "done", `lane "${lane.id}" passed`);
  if (choice.to === "@drop") return finish(ctx, "dropped", "dropped", said);
  if (choice.to === "@stop") {
    const code: StopCode = state.rejected
      ? "rejected"
      : choice.exhausted.length > 0
        ? "out_of_rounds"
        : "lane_failed";
    return finish(ctx, "stopped", code, choice.exhausted.length > 0 ? `${said}, with no rounds left` : said);
  }
  if (choice.to === "@inbox") {
    return park(ctx, { kind: "answer", lane: lane.id }, "needs_person", `lane "${lane.id}" needs a person`, {
      kind: "question",
      body: note || `Lane "${lane.id}" needs a person.`,
    });
  }
  if (outcome !== "pass")
    addNote(state, choice.to, `Lane "${lane.id}" ended ${outcome}: ${note || "no reason given"}`);
  state.next = choice.to;
  state.seq += 1;
  store.saveState(ctx.db, run.id, state);
  return undefined;
}

/** One look at a wait lane. Returns the outcome when the wait is over, or the parked state when it is not. */
async function waitStep(
  ctx: Ctx,
  lane: Lane,
  laneRun: number,
): Promise<{ outcome: store.Outcome; note: string } | Parked> {
  const settings = lane.with as WaitSettings;
  const parked = ctx.state.parked?.kind === "wait" ? ctx.state.parked : undefined;
  const now = nowMs();
  if (settings.minutes !== undefined) {
    const deadline = parked?.deadline ?? now + settings.minutes * MINUTE_MS;
    return now >= deadline
      ? { outcome: "pass", note: `waited ${settings.minutes} minutes` }
      : { kind: "wait", lane: lane.id, laneRun, deadline };
  }
  const until = settings.until;
  if (!until) throw new Error(`wait lane ${lane.id} has no settings`);
  const deadline = parked?.deadline ?? now + (settings.timeoutHours ?? 1) * 60 * MINUTE_MS;
  const outputsFile = join(ctx.outDir, `${String(ctx.state.seq).padStart(2, "0")}-${lane.id}.outputs.json`);
  rmSync(outputsFile, { force: true });
  const result = await sh(resolveCommand(ctx.ws, until, `Lane "${lane.id}"`), {
    cwd: ctx.run.worktree,
    env: hostEnv(ctx.ws.config.gateEnv, {
      FACTOR_RUN_ID: ctx.run.id,
      FACTOR_LANE: lane.id,
      FACTOR_OUTPUTS: outputsFile,
    }),
    timeoutMs: (until.timeoutMinutes ?? 10) * MINUTE_MS,
  });
  if (result.exitCode === 0) {
    try {
      const value: unknown = JSON.parse(readFileSync(outputsFile, "utf8"));
      if (typeof value === "object" && value !== null)
        ctx.state.outputs[lane.id] = value as Record<string, unknown>;
    } catch {
      ctx.state.outputs[lane.id] = {};
    }
    return { outcome: "pass", note: "the wait is over" };
  }
  if (now >= deadline)
    return { outcome: "needsPerson", note: `still waiting after ${settings.timeoutHours} hours` };
  return {
    kind: "wait",
    lane: lane.id,
    laneRun,
    deadline,
    nextCheck: Math.min(deadline, now + (settings.everyMinutes ?? 1) * MINUTE_MS),
  };
}

/** Move a run forward until it ends or has to wait. */
export async function advance(ctx: Ctx): Promise<RunSummary> {
  const { ws, db, run, state } = ctx;
  try {
    for (;;) {
      if (wasInterrupted()) return finish(ctx, "stopped", "interrupted", "interrupted");
      const lane = ws.workflow.lanes.find((l) => l.id === state.next);
      if (!lane) return finish(ctx, "stopped", "lane_failed", `the workflow has no lane "${state.next}"`);

      // no lane starts once the run's budget is spent
      const limits = ws.workflow.limits;
      const over: [StopCode, string] | undefined =
        state.spent.ms >= limits.minutes * MINUTE_MS
          ? ["budget_minutes", `${limits.minutes} minutes`]
          : state.spent.tokens >= limits.tokens
            ? ["budget_tokens", `${limits.tokens} tokens`]
            : limits.usd !== undefined && state.spent.usd >= limits.usd
              ? ["budget_usd", `${limits.usd} dollars`]
              : undefined;
      if (over)
        return finish(
          ctx,
          "stopped",
          over[0],
          `the run has used its budget of ${over[1]}, before lane "${lane.id}"`,
        );

      // a command, a wait or anything one-way is approved before it runs: afterwards is too late
      const before = lane.uses !== "core/agent@1" || lane.oneWay === true;
      if (lane.checkpoint === "in" && before && state.approved !== lane.id) {
        return park(
          ctx,
          { kind: "approve-before", lane: lane.id },
          "awaiting_approval",
          `lane "${lane.id}" waits for approval before it runs`,
          {
            kind: "approval",
            body: `Approve running lane "${lane.id}".`,
          },
        );
      }
      state.approved = undefined;

      const resumed =
        state.parked?.kind === "wait" && state.parked.lane === lane.id ? state.parked : undefined;
      const laneRun = resumed?.laneRun ?? store.startLane(db, run.id, lane.id, state.seq);
      let outcome: store.Outcome;
      let note: string;

      if (lane.uses === "core/wait@1") {
        const step = await waitStep(ctx, lane, laneRun);
        if ("kind" in step) return park(ctx, step, "waiting", `lane "${lane.id}" is waiting`);
        state.parked = undefined;
        ({ outcome, note } = step);
        store.endLane(db, laneRun, outcome, note, null);
      } else {
        state.parked = undefined;
        const result = await runLane(ctx, lane, laneRun, state.seq);
        ({ outcome, note } = result);
        store.endLane(db, laneRun, outcome, note, result.handoffPath, result.cost);
        state.spent.ms += result.cost?.durationMs ?? 0;
        state.spent.tokens += result.cost?.tokens ?? 0;
        state.spent.usd += result.cost?.usd ?? 0;
        if (result.stop) return finish(ctx, "stopped", result.stop.code, result.stop.reason);
      }
      ctx.log.push(`  ${lane.id}: ${outcome}${note ? ` (${note})` : ""}`);
      store.saveState(db, run.id, state);

      if (outcome === "pass" && lane.checkpoint === "in" && !before) {
        return park(
          ctx,
          { kind: "approve-after", lane: lane.id, laneRun, note },
          "awaiting_approval",
          `lane "${lane.id}" waits for approval of its work`,
          {
            kind: "approval",
            body: `Approve the work of lane "${lane.id}".`,
          },
        );
      }
      const ended = applyOutcome(ctx, lane, outcome, note);
      if (ended) return ended;
    }
  } catch (error) {
    if (wasInterrupted()) return finish(ctx, "stopped", "interrupted", "interrupted");
    db.prepare(
      "update lane_runs set outcome = 'fail', note = ?, ended_at = ? where run_id = ? and outcome is null",
    ).run((error as Error).message, new Date(nowMs()).toISOString(), run.id);
    const summary = finish(
      ctx,
      "stopped",
      "crashed",
      error instanceof UserError ? error.message : `the run crashed: ${(error as Error).message}`,
    );
    if (error instanceof UserError) throw error;
    return summary;
  }
}

/** Wake the parked waits that are due, then take the next queued task through the workflow. */
export async function runNext(ws: Workspace): Promise<RunSummary> {
  preflight(ws);
  const db = openDb(ws.dbPath);
  const log: string[] = [];
  try {
    let last: RunSummary | undefined;
    for (const due of store.dueRuns(db)) {
      store.resumeRun(db, due.id);
      store.setTaskStatus(db, due.task_id, "running");
      log.push(`run ${due.id}: waking`);
      last = await advance(contextFor(ws, db, { ...due, status: "running" }, log));
    }

    const added = collect(ws, db);
    if (added > 0) log.push(`collected ${added} new task${added === 1 ? "" : "s"}`);
    const task = store.claimNextTask(db);
    if (!task) return last ?? { status: "none", log: [...log, "no queued task"] };

    const runId = randomBytes(4).toString("hex");
    const branch = `factor/${task.key}-${runId}`;
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
    } catch (error) {
      store.setTaskStatus(db, task.id, "queued"); // nothing started: the task goes back in the queue
      throw error;
    }
    store.addEvent(db, runId, "run.started", { task: task.title });
    log.push(`run ${runId}: ${task.title}`);
    const run = store.getRun(db, runId);
    if (!run) throw new Error("the run was not recorded");
    const ctx = contextFor(ws, db, run, log);
    try {
      mkdirSync(ctx.outDir, { recursive: true });
      addWorktree(ws.root, worktree, branch, base);
    } catch (error) {
      return finish(ctx, "stopped", "crashed", `the run could not start: ${(error as Error).message}`);
    }
    return await advance(ctx);
  } finally {
    db.close();
  }
}
