// Runs one lane: an agent (with retries after a crash and repairs after a failed gate) or a host
// command, then the lane's gates. Only the host's gates can pass a lane (ADR 0005).
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { holdAccount, recordUsage } from "../accounts.ts";
import { adapterFor } from "../agents/index.ts";
import { MINUTE_MS, nowMs } from "../clock.ts";
import type { Db } from "../db.ts";
import { saveEvidence, saveRunFile } from "../evidence.ts";
import { type Control, hostEnv, sh, wasInterrupted } from "../exec.ts";
import { Checkouts, SetupFailed } from "../gates/checkout.ts";
import { resolveCommand } from "../gates/command.ts";
import { runGate } from "../gates/index.ts";
import { branchTip, commitAll, currentBranch, git, gitConfigFingerprint, headOf } from "../git.ts";
import { checkHandoff, combineRisk, type Handoff, outputProblems, type RunRisk } from "../handoff.ts";
import type { CommandSettings } from "../schema/builtins.ts";
import type { Lane } from "../schema/workflow.ts";
import * as store from "../store.ts";
import type { Workspace } from "../workspace.ts";
import { asText, HANDOFF, handoffHelp, inputsOf, promptFor } from "./prompt.ts";
import type { LaneResult, RunState } from "./state.ts";
import type { Facts } from "./transition.ts";

export interface Ctx {
  ws: Workspace;
  db: Db;
  run: store.Run;
  task: store.Task;
  state: RunState;
  /** A folder beside the worktree where an agent or command may leave its hand-off or outputs. */
  outDir: string;
  log: string[];
  facts: () => Facts;
  /** The run's own ports, database name and browser session name, for its commands and gates (agents get it in task 10). */
  slotEnv: Record<string, string>;
  /** Cancels what the run is running when a person stops it, and records its commands for recovery. */
  control: Control & { signal: AbortSignal };
}

/** Why the run must stop now, if it must: the whole command was interrupted, or a person stopped this run. */
export function halted(ctx: Ctx): { code: "interrupted" | "stopped_by_person"; reason: string } | undefined {
  if (wasInterrupted()) return { code: "interrupted", reason: "interrupted" };
  if (ctx.control.signal.aborted) return { code: "stopped_by_person", reason: "stopped by a person" };
  return undefined;
}

const MAX_FILE_BYTES = 1_000_000;
const REPAIR_HEAD = 1500;
const REPAIR_TAIL = 4500;
const LIMIT_HOLD_MS = 60 * 60_000; // shortcut: a CLI that reports its limit is held for an hour. Read its reset time when one is seen.

/** A JSON object an agent or command left, or nothing when it is missing, too large or not an object. */
function readObject(path: string): { text: string; value: Record<string, unknown> } | undefined {
  if (!existsSync(path) || statSync(path).size > MAX_FILE_BYTES) return undefined;
  try {
    const text = readFileSync(path, "utf8");
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? { text, value: value as Record<string, unknown> }
      : undefined;
  } catch {
    return undefined;
  }
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]+/g;
/** Agent text on one line and bounded, for notes, logs and reports: it cannot forge a line of its own. */
export const oneLine = (text: string, max = 500) => {
  const flat = text.replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
};

export async function runLane(
  ctx: Ctx,
  lane: Lane,
  laneRun: number,
  seq: number,
): Promise<
  LaneResult & { cost: Parameters<typeof store.endLane>[5]; handoffPath: string | null; hold?: number }
> {
  const { ws, db, run, state } = ctx;
  const started = Date.now();
  const tag = `${String(seq).padStart(2, "0")}-${lane.id}`;
  const nth = (n: number) => (n > 1 ? `.${n}` : "");
  const baseEnv = {
    ...ctx.slotEnv,
    FACTOR_RUN_ID: run.id,
    FACTOR_LANE: lane.id,
    FACTOR_TASK_TITLE: ctx.task.title,
  };
  const inputEnv = Object.fromEntries(
    Object.entries(inputsOf(ctx, lane)).map(([k, v]) => [`FACTOR_INPUT_${k.toUpperCase()}`, v]),
  );
  const notes = state.notes[lane.id] ?? [];
  delete state.notes[lane.id];

  let outcome: store.Outcome = "pass";
  let note = "";
  let handoffPath: string | null = null;
  let stop: LaneResult["stop"];
  let hold: number | undefined;
  const usage = { tokens: 0, usd: 0 };
  let agentStarts = 0;
  let crashes = 0;
  let repairs = 0;
  let repair: { gate: string; output: string } | undefined;
  const failWith = (why: string) => {
    if (outcome !== "fail") [outcome, note] = ["fail", why];
  };
  // a lane's time is its own limit or what the run has left, whichever is less
  const runLeft = Math.max(1, ws.workflow.limits.minutes * MINUTE_MS - state.spent.ms);
  const laneMs = Math.min(lane.limits?.minutes ? lane.limits.minutes * MINUTE_MS : runLeft, runLeft);
  const done = () => ({
    outcome,
    note,
    stop,
    hold,
    handoffPath,
    cost: {
      attempts: Math.max(1, agentStarts),
      tokens: usage.tokens,
      usd: usage.usd,
      durationMs: Date.now() - started,
    },
  });

  for (;;) {
    outcome = "pass";
    note = "";
    let outputs: Record<string, unknown> = {};

    if (lane.uses === "core/command@1") {
      const command = resolveCommand(ws, (lane.with ?? {}) as CommandSettings, `Lane "${lane.id}"`);
      const tipBefore = branchTip(ws.root, run.branch);
      const outputsFile = join(ctx.outDir, `${tag}.outputs.json`);
      rmSync(outputsFile, { force: true }); // an earlier lane may have left a file here in this lane's name
      const minutes = (lane.with as CommandSettings).timeoutMinutes ?? 10;
      const result = await sh(command, {
        cwd: run.worktree,
        env: hostEnv(ws.config.gateEnv, { ...baseEnv, ...inputEnv, FACTOR_OUTPUTS: outputsFile }),
        timeoutMs: Math.min(minutes * MINUTE_MS, laneMs),
        ...ctx.control,
      });
      saveEvidence(ws, run.id, `${tag}.log`, `$ ${command}\n# exit ${result.exitCode}\n\n${result.output}`);
      if (result.exitCode !== 0)
        failWith(
          result.timedOut ? `out of time after ${minutes} minutes` : `command exited ${result.exitCode}`,
        );
      outputs = readObject(outputsFile)?.value ?? {};
      const wrong = outputProblems(lane, outputs);
      if (wrong.length > 0) {
        outputs = {};
        failWith(oneLine(`the command's outputs were rejected: ${wrong.join(" ")}`));
      }
      if ((lane.gates ?? []).length === 0 && branchTip(ws.root, run.branch) !== tipBefore) {
        failWith("its command committed to the run's branch, and the lane has no gate to check that commit");
      }
    } else {
      agentStarts += 1;
      const entry = state.entries[lane.id] ?? 0;
      state.entries[lane.id] = entry + 1;
      // each start of an agent gets a fresh folder of its own for its hand-off and evidence, so
      // nothing an earlier lane left there can be taken for this lane's
      const stem = `${tag}${nth(agentStarts)}`;
      const laneDir = join(ctx.outDir, stem);
      rmSync(laneDir, { recursive: true, force: true });
      const hostDir = join(ctx.outDir, `${stem}.host`); // the prompt file and the CLI's raw output
      rmSync(hostDir, { recursive: true, force: true });
      mkdirSync(hostDir, { recursive: true });
      const evidenceDir = join(laneDir, "evidence");
      mkdirSync(evidenceDir, { recursive: true });
      const agentHandoff = join(laneDir, "handoff.json");
      db.prepare("delete from claims where lane_run_id = ?").run(laneRun); // an earlier attempt's claims are replaced
      const binding = ws.local.roles[lane.agent?.role ?? ""];
      if (!binding) throw new Error(`no binding for lane ${lane.id}`);
      const { adapter, agent, account } = adapterFor(binding, lane);
      const prompt =
        promptFor(ctx, lane, notes, repair) + (account ? handoffHelp(lane, agentHandoff, evidenceDir) : "");
      saveRunFile(ws, run.id, "prompts", `${stem}.md`, prompt);
      store.addEvent(db, run.id, "lane.agent", { lane: lane.id, handoffPath: agentHandoff });
      if (adapter.guarded === false && agentStarts === 1) {
        ctx.log.push(`  ${lane.id}: ${agent} runs with no guard, so only the gates check its work`);
      }
      const gitBefore = gitConfigFingerprint(ws.root);
      const tipBefore = branchTip(ws.root, run.branch);
      const limit = new AbortController();
      const remaining = laneMs - (Date.now() - started);
      const timer = setTimeout(() => limit.abort(), Math.max(1, remaining));
      const stopNow = () => limit.abort();
      ctx.control.signal.addEventListener("abort", stopNow, { once: true });
      if (ctx.control.signal.aborted) limit.abort();
      const exit = await adapter
        .run({
          runId: run.id,
          lane,
          cwd: run.worktree,
          prompt,
          handoffPath: agentHandoff,
          evidenceDir,
          laneDir,
          hostDir,
          env: {
            ...baseEnv,
            ...inputEnv,
            FACTOR_HANDOFF: agentHandoff,
            FACTOR_EVIDENCE_DIR: evidenceDir,
            FACTOR_LANE_DIR: laneDir,
            FACTOR_WORKTREE: run.worktree,
            FACTOR_ACCESS: lane.agent?.access ?? "read",
            FACTOR_DEFAULT_BRANCH: currentBranch(ws.root),
          },
          entry,
          signal: limit.signal,
          pidFile: ctx.control.pidFile,
        })
        .finally(() => {
          clearTimeout(timer);
          ctx.control.signal.removeEventListener("abort", stopNow);
        });
      usage.tokens += exit.usage?.tokens ?? 0;
      usage.usd += exit.usage?.usd ?? 0;
      if (account) {
        recordUsage(account, exit.usage?.tokens ?? 0); // counted for the account, whatever came of the lane
        store.addEvent(db, run.id, "lane.session", {
          lane: lane.id,
          account,
          agent,
          sessionId: exit.sessionId ?? null,
        });
      }
      if (gitConfigFingerprint(ws.root) !== gitBefore) {
        stop = {
          code: "git_config_changed",
          reason: `git's configuration or hooks changed while lane "${lane.id}" worked`,
        };
        failWith(stop.reason);
        return done();
      }
      const halt = halted(ctx);
      if (halt) {
        stop = halt;
        failWith(halt.reason);
        return done();
      }
      if (limit.signal.aborted) {
        failWith(`out of time after ${lane.limits?.minutes ?? "the run's"} minutes`);
        return done();
      }
      if (exit.limit && account) {
        hold = nowMs() + LIMIT_HOLD_MS;
        holdAccount(account, hold);
        failWith(oneLine(`the account "${account}" reached its limit: ${exit.error ?? ""}`));
        return done();
      }
      if (account && lane.agent?.access !== "write") {
        // A lane that only reads leaves nothing behind. A commit or a changed file means its verdict
        // is about code it altered itself, so the lane fails. A scratch file is only removed.
        const changed = git(run.worktree, "status", "--porcelain", "--untracked-files=no") !== "";
        const committed = branchTip(ws.root, run.branch) !== tipBefore;
        const scratch = !changed && git(run.worktree, "status", "--porcelain") !== "";
        if (changed || committed) git(run.worktree, "reset", "--hard", "-q", tipBefore);
        git(run.worktree, "clean", "-fdq");
        if (changed || committed) {
          failWith(
            `lane "${lane.id}" only reads, and its agent changed the repository: the change was dropped`,
          );
          return done();
        }
        if (scratch) ctx.log.push(`  ${lane.id}: this lane only reads: files its agent left were removed`);
      }
      if (account && lane.agent?.access === "write") {
        // an agent in a sandbox cannot reach git's folder, and any agent can forget: what it left
        // uncommitted is committed here, so the gates judge all of its work
        try {
          commitAll(run.worktree, `${lane.id}: ${oneLine(ctx.task.title, 72)}`);
        } catch (error) {
          failWith(oneLine(`the host could not commit what the agent left: ${(error as Error).message}`));
        }
      }
      const handoff = readObject(agentHandoff);
      if (exit.exitCode !== 0 && !handoff && crashes < (lane.retry?.max ?? 0)) {
        crashes += 1; // a crash, not a round: start the agent again
        continue;
      }
      let said: Handoff | undefined;
      if (handoff) {
        // the host keeps its own copy: the record never points at a file an agent can rewrite
        handoffPath = saveRunFile(ws, run.id, "handoffs", `${stem}.json`, handoff.text).path;
        // nothing in a hand-off is used until the host has checked it (ADR 0006)
        const checked = checkHandoff(
          {
            ws,
            runId: run.id,
            tag: stem,
            base: run.base_commit,
            head: branchTip(ws.root, run.branch),
            gates: state.gates,
            evidenceDir,
          },
          lane,
          handoff.value,
        );
        if (checked.handoff) {
          said = checked.handoff;
          outputs = said.outputs ?? {};
          for (const claim of checked.claims) store.addClaim(db, run.id, laneRun, claim.text, claim.evidence);
          state.last = {
            lane: lane.id,
            summary: said.summary,
            open: said.open ?? [],
            claims: checked.claims.map((c) => `${c.text} (${c.evidence.map((e) => e.ref).join(", ")})`),
          };
          state.open = [
            ...(state.open ?? []).filter((o) => o.lane !== lane.id),
            ...(said.open ?? []).map((text) => ({ lane: lane.id, text })),
          ];
          // a one-way lane or a sensitive change is at least medium, even when the lane stated no risk
          const tier = ctx.facts().tier;
          const stated =
            said.risk ??
            (lane.oneWay || tier === "sensitive"
              ? { level: "low" as const, door: "two-way" as const, why: "No lane stated a risk." }
              : undefined);
          if (stated) {
            state.risk = combineRisk(state.risk as RunRisk | undefined, stated, {
              tier,
              oneWayLane: lane.oneWay === true,
            });
            store.setRunRisk(db, run.id, state.risk);
          }
        } else {
          const why = checked.problems.join("\n");
          if (exit.exitCode === 0 && repairs < (lane.limits?.repairRounds ?? 0)) {
            repairs += 1;
            repair = { gate: HANDOFF, output: why };
            continue;
          }
          failWith(oneLine(`the hand-off was rejected: ${checked.problems.join(" ")}`));
          if (state.last?.lane === lane.id) state.last = undefined;
          state.open = (state.open ?? []).filter((o) => o.lane !== lane.id);
        }
      }
      if (exit.error) failWith(oneLine(`the agent reported an error: ${exit.error}`));
      else if (exit.exitCode !== 0) failWith(`the agent exited ${exit.exitCode}`);
      else if (!handoff) failWith("the agent left no hand-off");
      else if (!said) failWith("the hand-off was rejected");
      else if (said.outcome === "needsPerson") [outcome, note] = ["needsPerson", oneLine(said.summary)];
      else if (said.outcome !== "pass") failWith(oneLine(said.summary));
      else note = oneLine(said.summary);
    }
    {
      const halt = halted(ctx);
      if (halt) {
        stop = halt;
        failWith(halt.reason); // no gate decided, so the lane did not pass
        return done();
      }
    }
    state.outputs[lane.id] = outputs;
    // an agent that asks for a person has not finished: there is nothing for the gates to judge yet
    if (outcome === "needsPerson") return done();

    // The commit of record is the run's branch as the repository has it. An agent controls its
    // own worktree, so what HEAD says there is checked, never trusted.
    const head = branchTip(ws.root, run.branch);
    store.setRunHead(db, run.id, head);
    let worktreeHead: string | undefined;
    try {
      worktreeHead = headOf(run.worktree);
    } catch {
      worktreeHead = undefined;
    }
    if (worktreeHead !== head) failWith("the worktree is no longer on the run's branch");

    const outputEnv = Object.fromEntries(
      Object.entries(outputs).map(([k, v]) => [`FACTOR_OUTPUT_${k.toUpperCase()}`, asText(v)]),
    );
    const results: Record<string, "pass" | "fail"> = {};
    let again = false;
    state.memo ??= {};
    const checkouts = new Checkouts(
      ws,
      run.id,
      tag,
      repairs + 1,
      { ...baseEnv, ...inputEnv, ...outputEnv },
      ctx.control,
    );
    try {
      for (const gateId of lane.gates ?? []) {
        const gate = ws.workflow.gates?.[gateId];
        if (!gate) continue;
        const record = await runGate({
          ws,
          runId: run.id,
          tag,
          attempt: repairs + 1,
          gateId,
          uses: gate.uses,
          settings: gate.with ?? {},
          base: run.base_commit,
          head,
          env: { ...baseEnv, ...inputEnv, ...outputEnv },
          checkouts,
          control: ctx.control,
          memo: state.memo,
        });
        {
          const halt = halted(ctx);
          if (halt) {
            stop = halt;
            failWith(halt.reason); // no gate decided, so the lane did not pass
            return done();
          }
        }
        store.addGateResult(db, run.id, laneRun, record);
        results[gateId] = record.status;
        const exit = record.exit_code === null ? "" : ` (exit ${record.exit_code})`;
        ctx.log.push(`  ${lane.id}: gate ${gateId} ${record.status}${exit} ${record.output_path}`);
        if (record.status === "pass" || gate.onFail === "inform") continue;
        if (gate.onFail === "stop") {
          stop = { code: "gate_stop", reason: `gate "${gateId}" failed and stops the run` };
          failWith(`gate "${gateId}" failed`);
        } else if (
          gate.onFail === "repair" &&
          outcome === "pass" &&
          repairs < (lane.limits?.repairRounds ?? 0)
        ) {
          repairs += 1;
          // the verdict is at the top of the evidence and the detail at the end: send both
          const output = readFileSync(join(ws.root, record.output_path), "utf8");
          const cut = output.length > REPAIR_TAIL + REPAIR_HEAD;
          repair = {
            gate: gateId,
            output: cut ? `${output.slice(0, REPAIR_HEAD)}\n[...]\n${output.slice(-REPAIR_TAIL)}` : output,
          };
          again = true;
        } else {
          failWith(
            gate.onFail === "repair" && repairs > 0
              ? `gate "${gateId}" still fails after ${repairs} repairs`
              : `gate "${gateId}" failed`,
          );
        }
        break;
      }
    } catch (error) {
      if (!(error instanceof SetupFailed)) throw error;
      {
        const halt = halted(ctx);
        if (halt) {
          stop = halt;
          failWith(halt.reason); // no gate decided, so the lane did not pass
          return done();
        }
      }
      // the project could not be set up in a clean checkout, so nothing could be checked
      store.addGateResult(db, run.id, laneRun, error.record);
      ctx.log.push(`  ${lane.id}: setup fail (exit ${error.record.exit_code}) ${error.record.output_path}`);
      failWith(
        `the workspace's setup command failed in the gate's checkout (exit ${error.record.exit_code})`,
      );
    } finally {
      checkouts.dispose();
    }
    state.gates[lane.id] = results;
    if (!again) return done();
  }
}
