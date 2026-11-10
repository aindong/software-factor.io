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
  /** How many times this lane's agent has been started in this run before now. */
  entry: number;
  /** Aborted when the lane's time is up or the run is interrupted. The adapter must stop its agent. */
  signal: AbortSignal;
}

export interface AgentExit {
  exitCode: number;
  usage?: { tokens: number; usd: number };
}

export interface AgentAdapter {
  run(job: AgentJob): Promise<AgentExit>;
}
