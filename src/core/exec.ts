// Runs a shell command for a gate or a command lane: bounded in time and output, with a small
// environment. Leaked environment variables were a main cause of false results in the first factory.
import { spawn } from "node:child_process";

export interface ExecResult {
  exitCode: number;
  /** stdout and stderr, in the order they arrived. */
  output: string;
  timedOut: boolean;
  durationMs: number;
}

const PASS_THROUGH = ["PATH", "HOME", "SHELL", "LANG", "LC_ALL", "TMPDIR", "USER", "TERM"];
const MAX_OUTPUT = 2_000_000;

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

export function sh(
  command: string,
  options: { cwd: string; env: Record<string, string>; timeoutMs: number },
): Promise<ExecResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    // its own process group, so a timeout can stop everything the command started
    const child = spawn("sh", ["-c", command], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let output = "";
    let timedOut = false;
    const take = (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT) output += chunk.toString("utf8");
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }, options.timeoutMs);
    const done = (exitCode: number) => {
      clearTimeout(timer);
      if (timedOut) output += `\n[stopped after ${Math.round(options.timeoutMs / 1000)}s: timed out]\n`;
      resolve({ exitCode, output, timedOut, durationMs: Date.now() - started });
    };
    child.on("error", (error) => {
      output += `\n[could not start: ${error.message}]\n`;
      done(127);
    });
    child.on("close", (code) => done(timedOut ? 124 : (code ?? 1)));
  });
}
