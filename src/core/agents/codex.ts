// Codex, run for one lane: `codex exec` with JSON events, the account's profile folder, and its own
// sandbox as the wall. In the sandbox it cannot write outside the worktree, and a read-only lane
// cannot write at all, so the hand-off is read from its last message (docs/research/agent-clis.md).
import type { Account } from "../accounts.ts";
import { type Choice, handoffFromText, LIMIT, profileEnv, runCli } from "./cli.ts";
import type { AgentAdapter } from "./types.ts";

type Event = Record<string, unknown>;
const messageOf = (e: Event | undefined) => {
  const error = e?.error as { message?: unknown } | undefined;
  return typeof error?.message === "string" ? error.message : typeof e?.message === "string" ? e.message : "";
};

export function codexAgent(account: Account, choice: Choice): AgentAdapter {
  return {
    guarded: true, // by the CLI's sandbox, not by the factory's guard
    async run(job) {
      const canWrite = job.lane.agent?.access === "write";
      const args = [
        "exec",
        "--json",
        "-C",
        job.cwd,
        "-s",
        canWrite ? "workspace-write" : "read-only",
        "-c",
        'approval_policy="never"',
        ...(choice.model ? ["-m", choice.model] : []),
        ...(choice.effort ? ["-c", `model_reasoning_effort="${choice.effort}"`] : []),
        ...(canWrite ? ["--add-dir", job.laneDir] : []),
        "-", // the prompt comes on stdin
      ];
      const out = await runCli(
        job,
        account.bin ?? "codex",
        args,
        profileEnv("CODEX_HOME", account.profile, ".codex"),
        true,
      );

      const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      let last = "";
      for (const e of out.events) {
        const used =
          e.type === "turn.completed" ? (e.usage as Record<string, unknown> | undefined) : undefined;
        if (used) {
          // cached input is part of the input the CLI reports, and reasoning is part of its output
          // (that the cache-write count is part of input too is assumed: no run has shown it above 0)
          const cached = Number(used.cached_input_tokens) || 0;
          const written = Number(used.cache_write_input_tokens) || 0;
          usage.input += (Number(used.input_tokens) || 0) - cached - written;
          usage.cacheRead += cached;
          usage.cacheWrite += written;
          usage.output += Number(used.output_tokens) || 0;
        }
        const item = e.type === "item.completed" ? (e.item as Event | undefined) : undefined;
        if (item?.type === "agent_message" && typeof item.text === "string") last = item.text;
      }
      const tokens = usage.input + usage.cacheRead + usage.cacheWrite + usage.output;
      // an error event can be a retry the CLI recovered from: it counts only when no turn finished after it
      const failedAt = out.events.findLastIndex((e) => e.type === "turn.failed" || e.type === "error");
      const doneAt = out.events.findLastIndex((e) => e.type === "turn.completed");
      const failed = failedAt > doneAt ? out.events[failedAt] : undefined;
      const started = out.events.find((e) => e.type === "thread.started");
      let error: string | undefined;
      if (failed) error = messageOf(failed) || "the turn failed";
      else if (out.exitCode !== 0) error = out.stderr || `codex exited ${out.exitCode}`;
      else handoffFromText(job, last);
      return {
        exitCode: out.exitCode,
        // the CLI reports no cost: the host prices the tokens. No finished turn means no usage at all.
        usage: doneAt < 0 ? undefined : { ...usage, tokens, usd: 0, costReported: false },
        model: choice.model, // the CLI does not print the model it used
        sessionId: typeof started?.thread_id === "string" ? started.thread_id : undefined,
        error,
        limit: error !== undefined && LIMIT.test(error),
        streamPath: out.streamPath,
      };
    },
  };
}
