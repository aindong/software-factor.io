// Runs one lane: an agent (with retries after a crash and repairs after a failed gate) or a host
// command, then the lane's gates. Only the host's gates can pass a lane (ADR 0005).
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fakeAgent } from "../agents/fake.ts";
import { MINUTE_MS } from "../clock.ts";
import type { Db } from "../db.ts";
import { saveEvidence, saveRunFile } from "../evidence.ts";
import { type Control, hostEnv, sh, wasInterrupted } from "../exec.ts";
import { Checkouts, SetupFailed } from "../gates/checkout.ts";
import { resolveCommand } from "../gates/command.ts";
import { runGate } from "../gates/index.ts";
import { branchTip, gitConfigFingerprint, headOf } from "../git.ts";
import { checkHandoff, combineRisk, type Handoff, type RunRisk } from "../handoff.ts";
import type { CommandSettings } from "../schema/builtins.ts";
import type { Lane } from "../schema/workflow.ts";
import * as store from "../store.ts";
import type { Workspace } from "../workspace.ts";
import type { LaneResult, RunState } from "./state.ts";
import { type Facts, valueAt } from "./transition.ts";

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
const HANDOFF = "hand-off"; // a rejected hand-off goes back to the agent like a failed repair gate
const REPAIR_HEAD = 1500;
const REPAIR_TAIL = 4500;

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

const asText = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v ?? ""));

/** The values a lane declared as inputs, read from what earlier lanes left. */
function inputsOf(ctx: Ctx, lane: Lane): Record<string, string> {
  const facts = ctx.facts();
  return Object.fromEntries(
    Object.entries(lane.inputs ?? {}).map(([name, ref]) => [name, asText(valueAt(ref, facts))]),
  );
}

function promptFor(ctx: Ctx, lane: Lane, notes: string[], repair?: { gate: string; output: string }): string {
  const parts = [ctx.ws.prompts[lane.id] ?? "", `# Task\n\n${ctx.task.title}\n\n${ctx.task.body}`];
  const inputs = Object.entries(inputsOf(ctx, lane));
  if (inputs.length > 0) parts.push(`# Inputs\n\n${inputs.map(([k, v]) => `${k}: ${v}`).join("\n")}`);
  if (notes.length > 0) parts.push(`# Why you are here again\n\n${notes.map((n) => `- ${n}`).join("\n")}`);
  const last = ctx.state.last;
  if (last && last.lane !== lane.id) {
    const open = last.open.length > 0 ? `\n\nStill open:\n${last.open.map((o) => `- ${o}`).join("\n")}` : "";
    const claims =
      last.claims.length > 0
        ? `\n\nIt claims, with evidence the host checked:\n${last.claims.map((c) => `- ${c}`).join("\n")}`
        : "";
    parts.push(`# Hand-off from the lane "${last.lane}"\n\n${last.summary}${open}${claims}`);
  }
  if (repair?.gate === HANDOFF) {
    parts.push(
      `# Your hand-off was rejected\n\nThe host checks every hand-off before using it. Fix this and hand off again.\n\n${repair.output}`,
    );
  } else if (repair) {
    parts.push(
      `# The gate "${repair.gate}" failed on your work\n\nFix what it reports, commit, and hand off again.\n\n${repair.output}`,
    );
  }
  return `${parts.join("\n\n")}\n`;
}

export async function runLane(
  ctx: Ctx,
  lane: Lane,
  laneRun: number,
  seq: number,
): Promise<LaneResult & { cost: Parameters<typeof store.endLane>[5]; handoffPath: string | null }> {
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
      if ((lane.gates ?? []).length === 0 && branchTip(ws.root, run.branch) !== tipBefore) {
        failWith("its command committed to the run's branch, and the lane has no gate to check that commit");
      }
    } else {
      agentStarts += 1;
      const entry = state.entries[lane.id] ?? 0;
      state.entries[lane.id] = entry + 1;
      const agentHandoff = join(ctx.outDir, `${tag}${nth(agentStarts)}.json`);
      const evidenceDir = join(ctx.outDir, "evidence");
      const prompt = promptFor(ctx, lane, notes, repair);
      saveRunFile(ws, run.id, "prompts", `${tag}${nth(agentStarts)}.md`, prompt);
      store.addEvent(db, run.id, "lane.agent", { lane: lane.id, handoffPath: agentHandoff });

      const binding = ws.local.roles[lane.agent?.role ?? ""];
      if (!binding) throw new Error(`no binding for lane ${lane.id}`);
      const gitBefore = gitConfigFingerprint(ws.root);
      const limit = new AbortController();
      const remaining = laneMs - (Date.now() - started);
      const timer = setTimeout(() => limit.abort(), Math.max(1, remaining));
      const stopNow = () => limit.abort();
      ctx.control.signal.addEventListener("abort", stopNow, { once: true });
      if (ctx.control.signal.aborted) limit.abort();
      const exit = await fakeAgent(binding)
        .run({
          runId: run.id,
          lane,
          cwd: run.worktree,
          prompt,
          handoffPath: agentHandoff,
          evidenceDir,
          entry,
          signal: limit.signal,
        })
        .finally(() => {
          clearTimeout(timer);
          ctx.control.signal.removeEventListener("abort", stopNow);
        });
      usage.tokens += exit.usage?.tokens ?? 0;
      usage.usd += exit.usage?.usd ?? 0;
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
      const handoff = readObject(agentHandoff);
      if (exit.exitCode !== 0 && !handoff && crashes < (lane.retry?.max ?? 0)) {
        crashes += 1; // a crash, not a round: start the agent again
        continue;
      }
      let said: Handoff | undefined;
      if (handoff) {
        const stem = `${tag}${nth(agentStarts)}`;
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
          if (said.risk) {
            state.risk = combineRisk(state.risk as RunRisk | undefined, said.risk, {
              tier: ctx.facts().tier,
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
          failWith(`the hand-off was rejected: ${checked.problems.join(" ")}`);
        }
      }
      if (exit.exitCode !== 0) failWith(`the agent exited ${exit.exitCode}`);
      else if (!handoff) failWith("the agent left no hand-off");
      else if (!said) failWith("the hand-off was rejected");
      else if (said.outcome === "needsPerson") [outcome, note] = ["needsPerson", said.summary];
      else if (said.outcome !== "pass") failWith(said.summary);
      else note = said.summary;
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
