// What every agent CLI has in common: start it in the worktree with a small environment, keep its
// output apart from its diagnostics, stop it and everything it started, and read what it printed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { hostEnv, sh } from "../exec.ts";
import type { AgentJob } from "./types.ts";

const NO_TIMEOUT = 2 ** 31 - 1; // the lane's own clock stops the agent, through the job's signal
const ERROR_TAIL = 2000;

/** One argument, safe inside a shell command. */
export const quote = (arg: string) => `'${arg.replaceAll("'", "'\\''")}'`;

/** What a CLI says when the account has no quota left. */
export const LIMIT = /usage limit|rate limit|limit reached|quota exceeded|out of credits|too many requests/i;

/** The model and effort a lane gets from its role's binding. */
export interface Choice {
  model?: string;
  effort?: string;
}

/**
 * The variable that points a CLI at an account's profile folder. The CLI's default folder is left
 * unnamed, so the login it already has there is found exactly as when a person runs it.
 */
export function profileEnv(variable: string, profile: string | undefined, defaultDir: string) {
  if (!profile || resolve(profile) === join(homedir(), defaultDir)) return {};
  return { [variable]: profile };
}

export interface CliResult {
  exitCode: number;
  /** Each line of the CLI's output that is a JSON object. */
  events: Record<string, unknown>[];
  streamPath: string;
  /** The end of what the CLI printed as diagnostics. */
  stderr: string;
}

/** Run an agent CLI to its end. The prompt is given on stdin when `stdin` is set. */
export async function runCli(
  job: AgentJob,
  bin: string,
  args: string[],
  env: Record<string, string>,
  stdin: boolean,
): Promise<CliResult> {
  const promptFile = join(job.hostDir, "prompt.md");
  const streamPath = join(job.hostDir, "stream.jsonl");
  const errorFile = join(job.hostDir, "stderr.log");
  writeFileSync(promptFile, job.prompt);
  // the CLI's diagnostics are not JSON: they go to a file of their own, never into the stream
  const command = [
    quote(bin),
    ...args.map(quote),
    ...(stdin ? [`< ${quote(promptFile)}`] : []),
    `> ${quote(streamPath)} 2> ${quote(errorFile)}`,
  ].join(" ");
  const result = await sh(command, {
    cwd: job.cwd,
    env: hostEnv([], { ...job.env, ...env }),
    timeoutMs: NO_TIMEOUT,
    signal: job.signal,
    pidFile: job.pidFile,
  });
  const events: Record<string, unknown>[] = [];
  // shortcut: the whole stream is read into memory. Read it line by line if sessions pass 100 MB.
  for (const line of existsSync(streamPath) ? readFileSync(streamPath, "utf8").split("\n") : []) {
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === "object" && value !== null) events.push(value as Record<string, unknown>);
    } catch {
      // not an event
    }
  }
  const stderr = existsSync(errorFile) ? readFileSync(errorFile, "utf8").slice(-ERROR_TAIL).trim() : "";
  return { exitCode: result.exitCode, events, streamPath, stderr: stderr || result.output.trim() };
}

/**
 * An agent that cannot write the hand-off file, such as one in a read-only sandbox, gives it in its
 * last message: the whole message, or its last fenced block. The host checks it like any hand-off.
 */
export function handoffFromText(job: AgentJob, text: string): void {
  if (existsSync(job.handoffPath)) return;
  const blocks = [...text.matchAll(/```(?:json)?[ \t]*\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
  for (const candidate of [text, ...blocks.reverse()]) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (typeof value !== "object" || value === null || !("outcome" in value)) continue;
      writeFileSync(job.handoffPath, candidate, { flag: "wx" }); // never through a link an agent left
      return;
    } catch {
      // not a hand-off
    }
  }
}
