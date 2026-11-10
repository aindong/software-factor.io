// Runs a shell command for a gate or a command lane: bounded in time and output, with a small
// environment. Leaked environment variables were a main cause of false results in the first factory.
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export interface ExecResult {
  exitCode: number;
  /** stdout and stderr, in the order they arrived. */
  output: string;
  timedOut: boolean;
  durationMs: number;
}

const PASS_THROUGH = ["PATH", "HOME", "SHELL", "LANG", "LC_ALL", "TMPDIR", "USER", "TERM"];
const MAX_OUTPUT = 2_000_000;
const MAX_TIMER = 2 ** 31 - 1; // a longer delay overflows and fires at once
const DRAIN_MS = 200; // after the command exits, how long to wait for the rest of its output

/** The environment a host-run command gets: a short allow-list plus what the caller adds. */
export function hostEnv(
  extraNames: string[] = [],
  extra: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of [...PASS_THROUGH, ...extraNames]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...extra };
}

// Every command runs in its own process group, so one signal stops everything it started.
const running = new Set<number>();
let interrupted = false;

function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // already gone
  }
}

/** Stop every command that is running. The engine then ends its run as stopped. */
export function interrupt(): void {
  interrupted = true;
  for (const pid of running) killGroup(pid);
}
export const wasInterrupted = () => interrupted;

export function sh(
  command: string,
  options: { cwd: string; env: Record<string, string>; timeoutMs: number },
): Promise<ExecResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const pid = child.pid;
    if (pid) running.add(pid);
    let output = "";
    let cut = false;
    let timedOut = false;
    let settled = false;
    for (const stream of [child.stdout, child.stderr]) {
      const decoder = new StringDecoder("utf8");
      stream.on("data", (chunk: Buffer) => {
        if (output.length >= MAX_OUTPUT) cut = true;
        else output += decoder.write(chunk);
      });
    }
    const timer = setTimeout(
      () => {
        timedOut = true;
        if (pid) killGroup(pid);
      },
      Math.min(options.timeoutMs, MAX_TIMER),
    );
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pid) {
        running.delete(pid);
        killGroup(pid); // nothing the command started may outlive it
      }
      child.stdout.destroy();
      child.stderr.destroy();
      if (cut) output += "\n[output cut at 2 MB]\n";
      if (timedOut) output += `\n[stopped after ${Math.round(options.timeoutMs / 1000)}s: timed out]\n`;
      resolve({ exitCode: timedOut ? 124 : code, output, timedOut, durationMs: Date.now() - started });
    };
    child.on("error", (error) => {
      output += `\n[could not start: ${error.message}]\n`;
      settle(127);
    });
    // "exit" is the command itself ending. "close" also waits for anything still holding its
    // output open, which a background process can do for ever, so do not depend on it.
    child.on("exit", (code) => setTimeout(() => settle(code ?? 137), DRAIN_MS));
    child.on("close", (code) => settle(code ?? 137));
  });
}
