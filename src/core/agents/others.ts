// Kimi Code, and any command at all. Neither can run the factory's guard, so the run says so:
// for these two, the gates are the only wall.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Account } from "../accounts.ts";
import { hostEnv, sh } from "../exec.ts";
import { type Choice, handoffFromText, LIMIT, profileEnv, runCli } from "./cli.ts";
import type { AgentAdapter } from "./types.ts";

/** Kimi Code in print mode. Written from its documentation: no run of the real CLI has checked it. */
export function kimiAgent(account: Account, choice: Choice): AgentAdapter {
  return {
    guarded: false,
    async run(job) {
      const args = [
        "-p",
        job.prompt,
        "--output-format",
        "stream-json",
        ...(choice.model ? ["-m", choice.model] : []),
      ];
      const env = profileEnv("KIMI_CODE_HOME", account.profile, ".kimi-code");
      const out = await runCli(job, account.bin ?? "kimi", args, env, false);
      const said = out.events.findLast((e) => e.role === "assistant" && typeof e.content === "string");
      const error = out.exitCode !== 0 ? out.stderr || `kimi exited ${out.exitCode}` : undefined;
      if (!error) handoffFromText(job, String(said?.content ?? ""));
      // shortcut: usage is not read, because what the CLI prints for it is not documented. Add it once seen.
      return {
        exitCode: out.exitCode,
        error,
        limit: error !== undefined && LIMIT.test(error),
        streamPath: out.streamPath,
      };
    },
  };
}

/** Any command: it finds the prompt in $FACTOR_PROMPT_FILE and leaves its hand-off at $FACTOR_HANDOFF. */
export function commandAgent(account: Account): AgentAdapter {
  return {
    guarded: false,
    async run(job) {
      const promptFile = join(job.hostDir, "prompt.md");
      writeFileSync(promptFile, job.prompt);
      const result = await sh(account.command ?? "false", {
        cwd: job.cwd,
        env: hostEnv([], { ...job.env, FACTOR_PROMPT_FILE: promptFile }),
        timeoutMs: 2 ** 31 - 1, // the lane's own clock stops it, through the job's signal
        signal: job.signal,
        pidFile: job.pidFile,
      });
      writeFileSync(join(job.hostDir, "output.log"), result.output);
      return { exitCode: result.exitCode };
    },
  };
}
