// One start of one agent on a lane: a fresh folder of its own, its prompt on the record, the CLI
// run to its end or to its time limit, and a session row for it. A lane and each member of a panel
// start an agent the same way.
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { adapterFor, serverFor } from "../agents/index.ts";
import type { AgentExit } from "../agents/types.ts";
import { saveRunFile } from "../evidence.ts";
import { currentBranch, protectedBranches } from "../git.ts";
import type { Lane } from "../schema/workflow.ts";
import { clearServed } from "../served.ts";
import * as store from "../store.ts";
import type { Ctx } from "./lane.ts";
import { handoffHelp } from "./prompt.ts";
import { recordSession } from "./session.ts";

export interface Started {
  exit: AgentExit;
  /** The cost to count against the run: 0 when it is unknown. */
  usd: number;
  /** The start was stopped because its time was up, or because the run was stopped. */
  cutOff: boolean;
  laneDir: string;
  evidenceDir: string;
  agentHandoff: string;
  agent: string;
  account?: string;
}

export async function startAgent(
  ctx: Ctx,
  /** The lane, or a panel member's own lane, named "<lane>.<member>". */
  lane: Lane,
  at: {
    laneRun: number;
    /** The name of this start's files: "<seq>-<lane>" plus the try. */
    stem: string;
    try: number;
    entry: number;
    /** The prompt so far. A real agent is also told how to hand off. */
    prompt: string;
    env: Record<string, string>;
    /** How long the start may take. */
    ms: number;
  },
): Promise<Started> {
  const { ws, db, run } = ctx;
  // each start of an agent gets a fresh folder of its own for its hand-off and evidence, so
  // nothing an earlier lane left there can be taken for this lane's
  const laneDir = join(ctx.outDir, at.stem);
  rmSync(laneDir, { recursive: true, force: true });
  const hostDir = join(ctx.outDir, `${at.stem}.host`); // the prompt file and the CLI's raw output
  rmSync(hostDir, { recursive: true, force: true });
  mkdirSync(hostDir, { recursive: true });
  const evidenceDir = join(laneDir, "evidence");
  mkdirSync(evidenceDir, { recursive: true });
  clearServed(db, { run: run.id, slot: laneDir });
  const agentHandoff = join(laneDir, "handoff.json");

  const binding = ws.local.roles[lane.agent?.role ?? ""];
  if (!binding) throw new Error(`no binding for lane ${lane.id}`);
  const { adapter, agent, account } = adapterFor(binding, lane);
  const prompt =
    at.prompt + (account ? handoffHelp(lane, agentHandoff, evidenceDir, adapter.server === true) : "");
  saveRunFile(ws, run.id, "prompts", `${at.stem}.md`, prompt);
  store.addEvent(db, run.id, "lane.agent", { lane: lane.id, handoffPath: agentHandoff });
  if (adapter.guarded === false && at.try === 1) {
    ctx.log.push(`  ${lane.id}: ${agent} runs with no guard, so only the gates check its work`);
  }

  const limit = new AbortController();
  const timer = setTimeout(() => limit.abort(), Math.max(1, at.ms));
  const stopNow = () => limit.abort();
  ctx.control.signal.addEventListener("abort", stopNow, { once: true });
  if (ctx.control.signal.aborted) limit.abort();
  const startedMs = Date.now();
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
        ...at.env,
        FACTOR_LANE: lane.id,
        FACTOR_HANDOFF: agentHandoff,
        FACTOR_EVIDENCE_DIR: evidenceDir,
        FACTOR_LANE_DIR: laneDir,
        FACTOR_WORKTREE: run.worktree,
        FACTOR_ACCESS: lane.agent?.access ?? "read",
        FACTOR_DEFAULT_BRANCH: currentBranch(ws.root),
      },
      protect: account ? protectedBranches(ws.root) : undefined,
      server: account ? serverFor(ws.root, run.id, lane.id, laneDir, account) : undefined,
      entry: at.entry,
      signal: limit.signal,
      pidFile: ctx.control.pidFile,
    })
    // an adapter that breaks on its CLI's output is a failed start, not a crashed run
    .catch((error): AgentExit => ({ exitCode: 1, error: `the adapter failed: ${(error as Error).message}` }))
    .finally(() => {
      clearTimeout(timer);
      ctx.control.signal.removeEventListener("abort", stopNow);
    });
  const usd = recordSession(
    ctx,
    { lane: lane.id, laneRun: at.laneRun, stem: at.stem, try: at.try, startedMs },
    { agent, account },
    exit,
  );
  return { exit, usd, cutOff: limit.signal.aborted, laneDir, evidenceDir, agentHandoff, agent, account };
}
