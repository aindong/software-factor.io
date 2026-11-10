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
  /** The command line of the factor MCP server for this lane, for a CLI that can be given one. */
  server?: string[];
  /** Branches the agent must not push to or move. */
  protect?: string[];
  /** How many times this lane's agent has been started in this run before now. */
  entry: number;
  /** Aborted when the lane's time is up or the run is interrupted. The adapter must stop its agent. */
  signal: AbortSignal;
  /** Where to write down the agent's process, so a later process can stop it after a crash. */
  pidFile?: string;
}

/** What one start of an agent used. `tokens` is the total: the kinds, when the CLI gives them, add up to it. */
export interface Usage {
  tokens: number;
  usd: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** False when the CLI reported no cost: the host prices the tokens, or says the cost is unknown. */
  costReported?: boolean;
}

export interface AgentExit {
  exitCode: number;
  /** Left out when the agent gave no usage: its tokens and cost are then unknown, not zero. */
  usage?: Usage;
  /** The model that worked, when the CLI says it or the binding names it. */
  model?: string;
  /** The CLI's own name for the session, to find its transcript or continue it. */
  sessionId?: string;
  /** What the CLI said went wrong, when it said so. */
  error?: string;
  /** The CLI said the account's limit is reached. */
  limit?: boolean;
  /** Set when the agent changed something that decides what its CLI runs later: the run stops. */
  tampered?: string;
  /** The CLI's raw output, one JSON object per line, when it has one. */
  streamPath?: string;
}

export interface AgentAdapter {
  /** True when this CLI is given the factor MCP server. */
  server?: boolean;
  /** False when nothing stands between this agent and the host but the gates. */
  guarded?: boolean;
  run(job: AgentJob): Promise<AgentExit>;
}
