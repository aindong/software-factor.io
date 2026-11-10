// Runs one lane: an agent (with retries after a crash and repairs after a failed gate) or a host
// command, then the lane's gates. Only the host's gates can pass a lane (ADR 0005).
import { readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { holdAccount } from "../accounts.ts";
import { MINUTE_MS, nowMs } from "../clock.ts";
import type { Db } from "../db.ts";
import { saveEvidence, saveRunFile } from "../evidence.ts";
import { type Control, hostEnv, sh, wasInterrupted } from "../exec.ts";
import { Checkouts, SetupFailed } from "../gates/checkout.ts";
import { resolveCommand } from "../gates/command.ts";
import { runGate } from "../gates/index.ts";
import { branchTip, gitConfigFingerprint, worktreeGit } from "../git.ts";
import { checkHandoff, combineRisk, type Handoff, outputProblems, type RunRisk } from "../handoff.ts";
import { readObject } from "../safe-read.ts";
import type { CommandSettings } from "../schema/builtins.ts";
import type { Lane } from "../schema/workflow.ts";
import { servedFor } from "../served.ts";
import * as store from "../store.ts";
import { oneLine } from "../text.ts";
import type { Workspace } from "../workspace.ts";
import { asText, HANDOFF, inputsOf, promptFor } from "./prompt.ts";
import { startAgent } from "./start.ts";
import type { LaneResult, RunState } from "./state.ts";
import type { Facts } from "./transition.ts";
import { settleTree } from "./tree.ts";

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

const REPAIR_HEAD = 1500;
const REPAIR_TAIL = 4500;
const LIMIT_HOLD_MS = 60 * 60_000; // shortcut: a CLI that reports its limit is held for an hour. Read its reset time when one is seen.

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
      const stem = `${tag}${nth(agentStarts)}`;
      db.prepare("delete from claims where lane_run_id = ?").run(laneRun); // an earlier attempt's claims are replaced
      const gitBefore = gitConfigFingerprint(ws.root);
      const tipBefore = branchTip(ws.root, run.branch);
      const treeBefore = realpathSync(run.worktree);
      const { exit, usd, cutOff, laneDir, evidenceDir, agentHandoff, account } = await startAgent(ctx, lane, {
        laneRun,
        stem,
        try: agentStarts,
        entry,
        prompt: promptFor(ctx, lane, notes, repair),
        env: { ...baseEnv, ...inputEnv },
        ms: laneMs - (Date.now() - started),
      });
      usage.tokens += exit.usage?.tokens ?? 0;
      usage.usd += usd;
      // what decides which programs the host and the agent's CLI run must be as it was
      const tampered =
        gitConfigFingerprint(ws.root) !== gitBefore
          ? `git's configuration or hooks changed while lane "${lane.id}" worked: look at .git/config, .git/hooks and your own git configuration before you commit`
          : exit.tampered;
      if (tampered) {
        stop = { code: "git_config_changed", reason: tampered };
        failWith(tampered);
        return done();
      }
      const halt = halted(ctx);
      if (halt) {
        stop = halt;
        failWith(halt.reason);
        return done();
      }
      // the account is held whatever else comes of the lane
      const held = exit.limit && account ? nowMs() + LIMIT_HOLD_MS : undefined;
      if (held !== undefined && account) holdAccount(account, held);
      if (account) {
        // before anything else can end the lane: what a read-only agent changed is dropped, and
        // what a writing agent left is committed, also when its time or its account ran out
        const settled = settleTree(
          ws,
          run,
          lane,
          { tip: tipBefore, path: treeBefore },
          `${lane.id}: ${oneLine(ctx.task.title, 72)}`,
          ctx.log,
        );
        if (settled.stop) stop = { code: "git_config_changed", reason: settled.fail ?? "" };
        if (settled.fail) {
          failWith(oneLine(settled.fail));
          return done();
        }
      }
      if (cutOff) {
        failWith(`out of time after ${lane.limits?.minutes ?? "the run's"} minutes`);
        return done();
      }
      if (held !== undefined) {
        hold = held;
        if (notes.length > 0) state.notes[lane.id] = notes; // the lane starts again and must be told again
        failWith(oneLine(`the account "${account}" reached its limit: ${exit.error ?? ""}`));
        return done();
      }
      // what the agent gave the factor server comes first: a question asked there stands
      const served = servedFor(db, { run: run.id, slot: laneDir });
      let handoff = served.handoff ?? readObject(agentHandoff);
      let inTheWay = false;
      if (exit.exitCode !== 0 && !handoff && crashes < (lane.retry?.max ?? 0)) {
        crashes += 1; // a crash, not a round: start the agent again
        continue;
      }
      let said: Handoff | undefined;
      if (handoff) {
        // the host keeps its own copy: the record never points at a file an agent can rewrite
        try {
          handoffPath = saveRunFile(ws, run.id, "handoffs", `${stem}.json`, handoff.text).path;
        } catch {
          [handoff, inTheWay] = [undefined, true]; // something is already where the copy goes
        }
      }
      if (handoff) {
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
            served: served.evidence,
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
      else if (inTheWay) failWith("a file was already where the host keeps this lane's hand-off");
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
      worktreeHead = worktreeGit(ws.root, run.worktree)("rev-parse", "--verify", "HEAD^{commit}");
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

export { oneLine };
