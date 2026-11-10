// A run from claim to end. The engine owns the state machine: it decides which lane is next, counts
// rounds, parks a run that waits for a person or a clock, and names every way a run can end (ADR 0013).
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { heldUntil } from "../accounts.ts";
import { accountOf, rolesOf, sameVendor } from "../agents/index.ts";
import { MINUTE_MS, nowMs } from "../clock.ts";
import { collectAll } from "../collectors/index.ts";
import type { Db } from "../db.ts";
import { UserError } from "../errors.ts";
import { hostEnv, sh } from "../exec.ts";
import { resolveCommand } from "../gates/command.ts";
import { branchTip, git, removeWorktree } from "../git.ts";
import type { WaitSettings } from "../schema/builtins.ts";
import type { Lane } from "../schema/workflow.ts";
import * as store from "../store.ts";
import type { Workspace } from "../workspace.ts";
import { type Ctx, halted, runLane } from "./lane.ts";
import { writeRunHandoff } from "./report.ts";
import { slotEnv } from "./slots.ts";
import { addNote, type Parked, type RunState, type StopCode } from "./state.ts";
import { tierOf } from "./tier.ts";
import { choose, type Facts, holds } from "./transition.ts";

export interface RunSummary {
  status: "none" | store.RunStatus;
  runId?: string;
  code?: string;
  reason?: string;
  /** One line per thing that happened, for the command line. */
  log: string[];
}

/** Ask every collector for tasks and add the new ones to the queue. Returns one line for each thing to say. */
export function collect(ws: Workspace, db: Db): string[] {
  const { added, said } = collectAll(ws, db);
  return [`collected ${added} new task${added === 1 ? "" : "s"}`, ...said];
}

export function contextFor(ws: Workspace, db: Db, run: store.Run, log: string[]): Ctx {
  const task = store.getTask(db, run.task_id);
  if (!task) throw new Error(`run ${run.id} has no task`);
  const state = JSON.parse(run.state) as RunState;
  const outDir = join(ws.workDir, `${run.id}.out`);
  mkdirSync(outDir, { recursive: true });
  const ctx: Ctx = {
    slotEnv: slotEnv(ws, store.getRun(db, run.id)?.slot),
    control: { signal: new AbortController().signal, pidFile: join(outDir, "pids") },
    ws,
    db,
    run,
    task,
    state,
    outDir: join(ws.workDir, `${run.id}.out`),
    log,
    facts: (): Facts => {
      let tier: string;
      try {
        const files = git(ws.root, "diff", "--name-only", run.base_commit, branchTip(ws.root, run.branch));
        tier = tierOf(files.split("\n").filter(Boolean));
      } catch {
        tier = "refactor"; // when the change cannot be read, do not treat it as the least risky kind
      }
      return {
        source: task.collector,
        labels: store.labelsOf(task),
        tier,
        outputs: state.outputs,
        gates: state.gates,
      };
    },
  };
  return ctx;
}

export function finish(
  ctx: Ctx,
  status: store.RunStatus,
  code: StopCode,
  reason: string,
  wakeAt: string | null = null,
): RunSummary {
  const { ws, db, run, state } = ctx;
  try {
    store.saveState(db, run.id, state);
  } catch {
    // a state that cannot be written must not leave the run "running": save it without lane values
    store.saveState(db, run.id, { ...state, outputs: {} });
  }
  store.endRun(db, run.id, status, code, reason, wakeAt);
  store.releaseSlot(db, run.id); // a run that is not moving holds no slot
  store.setTaskStatus(db, ctx.task.id, status === "running" ? "running" : status);
  store.addEvent(db, run.id, `run.${status}`, { code, reason });
  if (status === "done" || status === "dropped") {
    removeWorktree(ws.root, run.worktree);
    rmSync(ctx.outDir, { recursive: true, force: true });
  }
  ctx.log.push(`run ${run.id} ${status}: ${reason}`);
  if (status !== "running")
    ctx.log.push(`  hand-off: ${writeRunHandoff(ws, db, run, ctx.task, state, status, code, reason)}`);
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
  const timed = parked.kind === "wait" || parked.kind === "account";
  const wakeAt = timed ? new Date(parked.nextCheck ?? parked.deadline ?? nowMs()).toISOString() : null;
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
    // the head is remembered per lane gone back to, so two loops into one lane cannot hide it
    if (target?.agent?.access === "write" && state.loopHeads[choice.to] === head) {
      return finish(
        ctx,
        "stopped",
        "no_progress",
        `${said}, and "${choice.to}" made no new commit in the last round`,
      );
    }
    state.rounds[choice.key] = (state.rounds[choice.key] ?? 0) + 1;
    state.loopHeads[choice.to] = head;
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
    // the reason may be an agent's own words: it is marked as a quote, so it cannot pass for the host
    addNote(
      state,
      choice.to,
      `Lane "${lane.id}" ended ${outcome}. Its reason, which its agent may have written: "${note || "none given"}"`,
    );
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
      ...ctx.slotEnv,
      FACTOR_RUN_ID: ctx.run.id,
      FACTOR_LANE: lane.id,
      FACTOR_OUTPUTS: outputsFile,
    }),
    timeoutMs: (until.timeoutMinutes ?? 10) * MINUTE_MS,
    ...ctx.control,
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
    // counted from the end of the check: a check slower than the interval must not be due again at once
    nextCheck: Math.min(Math.max(deadline, nowMs() + 1), nowMs() + (settings.everyMinutes ?? 1) * MINUTE_MS),
  };
}

/** Move a run forward until it ends or has to wait. */
export async function advance(ctx: Ctx): Promise<RunSummary> {
  const { ws, db, run, state } = ctx;
  // another process can ask this run to stop: look for that request while the run works
  const stopper = new AbortController();
  ctx.control = { ...ctx.control, signal: stopper.signal };
  const watch = setInterval(() => {
    if (store.stopRequested(db, run.id)) stopper.abort();
  }, 400);
  try {
    for (;;) {
      const halt = halted(ctx);
      if (halt) return finish(ctx, "stopped", halt.code, halt.reason);
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

      // an account near its limit starts no lane, and no panel that one of its members is on
      let heldBy: { name: string; until: number } | undefined;
      // only the members that take part this time count: a review is sized to the change
      const facts = lane.panel ? ctx.facts() : undefined;
      const joins = (m: { when?: Parameters<typeof holds>[0] }) =>
        !m.when || (facts !== undefined && holds(m.when, facts));
      for (const role of rolesOf(lane, joins)) {
        const binding = ws.local.roles[role];
        const bound = binding ? accountOf(binding, role) : undefined;
        const until = bound ? heldUntil(bound.name, bound.account) : undefined;
        if (bound && until !== undefined && until > (heldBy?.until ?? 0))
          heldBy = { name: bound.name, until };
      }
      if (heldBy) {
        return park(
          ctx,
          { kind: "account", lane: lane.id, nextCheck: heldBy.until },
          "account_limit",
          `lane "${lane.id}" waits: the account "${heldBy.name}" is held until ${new Date(heldBy.until).toISOString()}`,
        );
      }

      // a command, a wait or anything one-way is approved before it runs: afterwards is too late
      const before = lane.uses !== "core/agent@1" || lane.oneWay === true;
      const midWait = state.parked?.kind === "wait" && state.parked.lane === lane.id; // approved before it began waiting
      if (lane.checkpoint === "in" && before && !midWait && state.approved !== lane.id) {
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
        // a stop that arrived during the check must end the run, not park it to be woken later
        const stopped = halted(ctx);
        if (stopped) {
          store.endLane(db, laneRun, "fail", stopped.reason, null);
          return finish(ctx, "stopped", stopped.code, stopped.reason);
        }
        if ("kind" in step) return park(ctx, step, "waiting", `lane "${lane.id}" is waiting`);
        state.parked = undefined;
        ({ outcome, note } = step);
        store.endLane(db, laneRun, outcome, note, null);
      } else {
        state.parked = undefined;
        // a review that should be on another vendor than the author and is not still runs: the run says so
        const hostNote = `${lane.id}, by the host`;
        state.open = (state.open ?? []).filter((o) => o.lane !== hostNote);
        for (const text of sameVendor(ws.workflow.roles, ws.local.roles, lane, joins)) {
          ctx.log.push(`  ${lane.id}: ${text}`);
          state.open.push({ lane: hostNote, text });
        }
        const result = await runLane(ctx, lane, laneRun, state.seq);
        ({ outcome, note } = result);
        state.spent.ms += result.cost?.durationMs ?? 0;
        state.spent.tokens += result.cost?.tokens ?? 0;
        state.spent.usd += result.cost?.usd ?? 0;
        store.endLane(db, laneRun, outcome, note, result.handoffPath, result.cost);
        if (result.stop) return finish(ctx, "stopped", result.stop.code, result.stop.reason);
        if (result.hold !== undefined) {
          // the account ran out while the lane worked: this try failed, and the lane starts again later
          state.seq += 1;
          return park(
            ctx,
            { kind: "account", lane: lane.id, nextCheck: result.hold },
            "account_limit",
            `lane "${lane.id}" waits: ${note}`,
          );
        }
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
    return crashed(ctx, error);
  } finally {
    clearInterval(watch);
  }
}

/** End a run that hit an error: close its open lane, name the reason, and leave nothing "running". */
export function crashed(ctx: Ctx, error: unknown): RunSummary {
  // a lane that broke after its agent ran has still spent what its sessions say
  const open = ctx.db
    .prepare(
      `select l.id, coalesce(sum(s.tokens), 0) as tokens, coalesce(sum(s.usd), 0) as usd
       from lane_runs l left join sessions s on s.lane_run_id = l.id
       where l.run_id = ? and l.outcome is null group by l.id`,
    )
    .all(ctx.run.id) as unknown as { id: number; tokens: number; usd: number }[];
  for (const lane of open) {
    ctx.db
      .prepare("update lane_runs set tokens = ?, usd = ? where id = ?")
      .run(lane.tokens, lane.usd, lane.id);
    ctx.state.spent.tokens += lane.tokens;
    ctx.state.spent.usd += lane.usd;
  }
  const halt = halted(ctx);
  if (halt) return finish(ctx, "stopped", halt.code, halt.reason);
  const message = (error as Error).message;
  ctx.db
    .prepare(
      "update lane_runs set outcome = 'fail', note = ?, ended_at = ? where run_id = ? and outcome is null",
    )
    .run(message, new Date(nowMs()).toISOString(), ctx.run.id);
  const summary = finish(
    ctx,
    "stopped",
    "crashed",
    error instanceof UserError ? message : `the run crashed: ${message}`,
  );
  if (error instanceof UserError) throw error;
  return summary;
}
