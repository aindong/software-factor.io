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

      let tokens = 0;
      let last = "";
      for (const e of out.events) {
        const usage =
          e.type === "turn.completed" ? (e.usage as Record<string, unknown> | undefined) : undefined;
        // cached input is part of input, and reasoning is part of output
        if (usage) tokens += (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0);
        const item = e.type === "item.completed" ? (e.item as Event | undefined) : undefined;
        if (item?.type === "agent_message" && typeof item.text === "string") last = item.text;
      }
      const failed = out.events.findLast((e) => e.type === "turn.failed" || e.type === "error");
      const started = out.events.find((e) => e.type === "thread.started");
      let error: string | undefined;
      if (failed) error = messageOf(failed) || "the turn failed";
      else if (out.exitCode !== 0) error = out.stderr || `codex exited ${out.exitCode}`;
      else handoffFromText(job, last);
      return {
        exitCode: out.exitCode,
        usage: { tokens, usd: 0 }, // the CLI reports no cost: the cost report prices the tokens (task 11)
        sessionId: typeof started?.thread_id === "string" ? started.thread_id : undefined,
        error,
        limit: error !== undefined && LIMIT.test(error),
        streamPath: out.streamPath,
      };
    },
  };
}
