// One run: claim a task, give it a worktree, take it through the lanes, and end it. The engine owns
// the state machine. Agents only fill lanes, and only the host's gates can pass one (ADR 0005).
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeAgent } from "../agents/fake.ts";
import type { AgentAdapter } from "../agents/types.ts";
import { collectFile } from "../collectors/file.ts";
import { type Db, openDb } from "../db.ts";
import { UserError } from "../errors.ts";
import { saveEvidence } from "../evidence.ts";
import { hostEnv, sh } from "../exec.ts";
import { resolveCommand, runCommandGate } from "../gates/command.ts";
import { addWorktree, headOf, removeWorktree } from "../git.ts";
import type { Lane, Workflow } from "../schema/workflow.ts";
import * as store from "../store.ts";
import type { Workspace } from "../workspace.ts";

export interface RunSummary {
  status: "none" | store.RunStatus;
  runId?: string;
  title?: string;
  reason?: string;
  /** One line per thing that happened, for the command line. */
  log: string[];
}

const SUPPORTED_LANES = ["core/agent@1", "core/command@1"];
const LATER = (what: string, task: number) =>
  new UserError(
    `${what} is not built yet.`,
    `It arrives with task ${task} of the plan. Until then, leave it out of the workflow.`,
  );

/** Refuse a workflow this version cannot run honestly, before any task is claimed. */
function preflight(ws: Workspace): void {
  const w: Workflow = ws.workflow;
  for (const lane of w.lanes) {
    if (!SUPPORTED_LANES.includes(lane.uses))
      throw LATER(`The lane type "${lane.uses}" (lane "${lane.id}")`, 6);
    if (lane.panel) throw LATER(`A panel (lane "${lane.id}")`, 13);
    for (const [outcome, t] of Object.entries(lane.on)) {
      if (t !== undefined && typeof t !== "string")
        throw LATER(`A transition list (lane "${lane.id}", ${outcome})`, 6);
    }
    if (lane.agent && !Object.hasOwn(ws.local.roles, lane.agent.role)) {
      throw new UserError(
        `The role "${lane.agent.role}" (lane "${lane.id}") is not bound to an agent on this machine.`,
        `Add "${lane.agent.role}" under "roles" in .factor/local.json.`,
      );
    }
    if (lane.uses === "core/command@1") resolveCommand(ws, lane.with ?? {}, `Lane "${lane.id}"`);
    for (const gateId of lane.gates ?? []) {
      const gate = w.gates?.[gateId];
      if (!gate) continue;
      if (gate.uses !== "core/command@1") throw LATER(`The gate type "${gate.uses}" (gate "${gateId}")`, 7);
      if (gate.onFail === "repair")
        throw LATER(`Sending a failed gate back for repair (gate "${gateId}")`, 6);
      resolveCommand(ws, gate.with ?? {}, `Gate "${gateId}"`);
    }
  }
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

function adapterFor(ws: Workspace, lane: Lane): AgentAdapter {
  const binding = ws.local.roles[lane.agent?.role ?? ""];
  if (!binding) throw new Error(`no binding for lane ${lane.id}`);
  return fakeAgent(binding);
}

function promptFor(ws: Workspace, lane: Lane, task: store.Task): string {
  const p = lane.agent?.prompt ?? "";
  const text = typeof p === "string" ? p : readFileSync(join(ws.factorDir, "workflows", p.file), "utf8");
  return `${text}\n\n# Task\n\n${task.title}\n\n${task.body}\n`;
}

interface Handoff {
  outcome?: unknown;
  summary?: unknown;
  outputs?: Record<string, unknown>;
}

function readHandoff(path: string): Handoff | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof value === "object" && value !== null ? (value as Handoff) : undefined;
  } catch {
    return undefined;
  }
}

export async function runNext(ws: Workspace): Promise<RunSummary> {
  preflight(ws);
  const db = openDb(ws.dbPath);
  const log: string[] = [];
  try {
    const added = collect(ws, db);
    if (added > 0) log.push(`collected ${added} new task${added === 1 ? "" : "s"}`);
    const task = store.claimNextTask(db);
    if (!task) return { status: "none", log: [...log, "no queued task"] };

    const runId = randomBytes(4).toString("hex");
    const base = headOf(ws.root);
    const branch = `factor/${task.key}-${runId}`;
    const worktree = join(ws.workDir, runId);
    store.createRun(db, {
      id: runId,
      task_id: task.id,
      workflow: ws.workflow.name,
      base_commit: base,
      branch,
      worktree,
    });
    store.addEvent(db, runId, "run.started", { task: task.title });
    log.push(`run ${runId}: ${task.title}`);

    const finish = (status: store.RunStatus, reason: string): RunSummary => {
      store.endRun(db, runId, status, reason);
      store.setTaskStatus(db, task.id, status === "running" ? "running" : status);
      store.addEvent(db, runId, `run.${status}`, { reason });
      if (status === "done" || status === "dropped") removeWorktree(ws.root, worktree);
      log.push(`run ${runId} ${status}: ${reason}`);
      return { status, runId, title: task.title, reason, log };
    };

    try {
      mkdirSync(ws.workDir, { recursive: true });
      addWorktree(ws.root, worktree, branch, base);
      const runDir = join(ws.runsDir, runId);
      mkdirSync(join(runDir, "handoffs"), { recursive: true });
      mkdirSync(join(runDir, "prompts"), { recursive: true });

      let lane: Lane | undefined = ws.workflow.lanes[0];
      for (let seq = 1; lane; seq++) {
        const laneRun = store.startLane(db, runId, lane.id, seq);
        const tag = `${String(seq).padStart(2, "0")}-${lane.id}`;
        const baseEnv = { FACTOR_RUN_ID: runId, FACTOR_LANE: lane.id, FACTOR_TASK_TITLE: task.title };
        let outcome: store.Outcome = "pass";
        let note = "";
        let handoffPath: string | null = null;
        let outputs: Record<string, unknown> = {};

        if (lane.uses === "core/command@1") {
          if (lane.checkpoint === "in") {
            // a command is approved before it runs: afterwards is too late
            store.endLane(db, laneRun, "needsPerson", "waiting for approval before it runs", null);
            store.addInbox(db, runId, lane.id, "approval", `Approve running lane "${lane.id}".`);
            return finish("waiting", `lane "${lane.id}" waits for approval`);
          }
          const command = resolveCommand(ws, lane.with ?? {}, `Lane "${lane.id}"`);
          const result = await sh(command, {
            cwd: worktree,
            env: hostEnv(ws.config.gateEnv, baseEnv),
            timeoutMs: 600_000,
          });
          saveEvidence(
            ws,
            runId,
            `${tag}.log`,
            `$ ${command}\n# exit ${result.exitCode}\n\n${result.output}`,
          );
          if (result.exitCode !== 0) [outcome, note] = ["fail", `command exited ${result.exitCode}`];
        } else {
          handoffPath = join(runDir, "handoffs", `${tag}.json`);
          const prompt = promptFor(ws, lane, task);
          writeFileSync(join(runDir, "prompts", `${tag}.md`), prompt);
          const exit = await adapterFor(ws, lane).run({ runId, lane, cwd: worktree, prompt, handoffPath });
          const handoff = readHandoff(handoffPath);
          outputs = handoff?.outputs ?? {};
          if (exit.exitCode !== 0) [outcome, note] = ["fail", `the agent exited ${exit.exitCode}`];
          else if (!handoff) [outcome, note] = ["fail", "the agent left no hand-off"];
          else if (handoff.outcome === "needsPerson")
            [outcome, note] = ["needsPerson", String(handoff.summary ?? "")];
          else if (handoff.outcome !== "pass")
            [outcome, note] = ["fail", String(handoff.summary ?? "the agent reported failure")];
          else note = String(handoff.summary ?? "");
        }

        const head = headOf(worktree);
        store.setRunHead(db, runId, head);

        // The host's gates decide. An agent's "pass" only means the gates are worth running.
        let stopped: string | undefined;
        const outputEnv = Object.fromEntries(
          Object.entries(outputs).map(([k, v]) => [
            `FACTOR_OUTPUT_${k.toUpperCase()}`,
            typeof v === "string" ? v : JSON.stringify(v),
          ]),
        );
        for (const gateId of lane.gates ?? []) {
          const gate = ws.workflow.gates?.[gateId];
          if (!gate) continue;
          const record = await runCommandGate({
            ws,
            runId,
            seq,
            lane: lane.id,
            gateId,
            uses: gate.uses,
            settings: gate.with ?? {},
            commit: head,
            env: { ...baseEnv, ...outputEnv },
          });
          store.addGateResult(db, runId, laneRun, record);
          log.push(
            `  ${lane.id}: gate ${gateId} ${record.status} (exit ${record.exit_code}) ${record.output_path}`,
          );
          if (record.status === "fail" && gate.onFail !== "inform") {
            if (outcome === "pass") [outcome, note] = ["fail", `gate "${gateId}" failed`];
            if (gate.onFail === "stop") {
              stopped = `gate "${gateId}" failed and stops the run`;
              break;
            }
          }
        }

        store.endLane(
          db,
          laneRun,
          outcome,
          note,
          handoffPath && existsSync(handoffPath) ? handoffPath : null,
        );
        log.push(`  ${lane.id}: ${outcome}${note ? ` (${note})` : ""}`);
        if (stopped) return finish("stopped", stopped);

        if (outcome === "pass" && lane.checkpoint === "in" && lane.uses === "core/agent@1") {
          store.addInbox(db, runId, lane.id, "approval", `Approve the work of lane "${lane.id}".`);
          return finish("waiting", `lane "${lane.id}" waits for approval`);
        }

        const target: string = (lane.on[outcome] as string | undefined) ?? "@inbox";
        if (target === "@done") return finish("done", `lane "${lane.id}" passed`);
        if (target === "@drop") return finish("dropped", `lane "${lane.id}" dropped the task`);
        if (target === "@stop")
          return finish("stopped", `lane "${lane.id}" ended ${outcome}${note ? `: ${note}` : ""}`);
        if (target === "@inbox") {
          store.addInbox(db, runId, lane.id, "question", note || `Lane "${lane.id}" needs a person.`);
          return finish("waiting", `lane "${lane.id}" needs a person`);
        }
        lane = ws.workflow.lanes.find((l) => l.id === target);
      }
      return finish("stopped", "the workflow ran out of lanes");
    } catch (error) {
      if (error instanceof UserError) {
        finish("stopped", error.message);
        throw error;
      }
      return finish("stopped", `the run crashed: ${(error as Error).message}`);
    }
  } finally {
    db.close();
  }
}
