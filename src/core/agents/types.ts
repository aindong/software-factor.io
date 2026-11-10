// What the engine asks of any agent, whatever tool is behind it (ADR 0003).
import type { Lane } from "../schema/workflow.ts";

export interface AgentJob {
  runId: string;
  lane: Lane;
  /** The worktree the agent works in. */
  cwd: string;
  prompt: string;
  /** Where the agent leaves its hand-off, outside the worktree so it is never committed. */
  handoffPath: string;
  /** Where the agent may leave files as evidence for its claims. The host copies what a claim names. */
  evidenceDir: string;
  /** The lane's own folder, which holds both of the above: the one place outside the worktree an agent may write. */
  laneDir: string;
  /** A folder only the host uses, for the prompt file and the CLI's raw output. */
  hostDir: string;
  /** What the agent's process may see beyond the basics: the run's slot and where to hand off. Never a key. */
  env: Record<string, string>;
  /** How many times this lane's agent has been started in this run before now. */
  entry: number;
  /** Aborted when the lane's time is up or the run is interrupted. The adapter must stop its agent. */
  signal: AbortSignal;
  /** Where to write down the agent's process, so a later process can stop it after a crash. */
  pidFile?: string;
}

export interface AgentExit {
  exitCode: number;
  usage?: { tokens: number; usd: number };
  /** The CLI's own name for the session, to find its transcript or continue it. */
  sessionId?: string;
  /** What the CLI said went wrong, when it said so. */
  error?: string;
  /** The CLI said the account's limit is reached. */
  limit?: boolean;
  /** The CLI's raw output, one JSON object per line, when it has one. */
  streamPath?: string;
}

export interface AgentAdapter {
  /** False when nothing stands between this agent and the host but the gates. */
  guarded?: boolean;
  run(job: AgentJob): Promise<AgentExit>;
}
