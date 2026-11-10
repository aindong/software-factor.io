// Claude Code, run for one lane: print mode with a JSON stream, the account's profile folder, and
// the factory's guard as a hook before every tool call (docs/research/agent-clis.md).
import type { Account } from "../accounts.ts";
import { type Choice, handoffFromText, LIMIT, profileEnv, quote, runCli } from "./cli.ts";
import type { AgentAdapter } from "./types.ts";

// A lane that only reads has no tool that writes files: it gives its hand-off in its last message.
const READ_TOOLS = ["Read", "Glob", "Grep", "Bash"];
const WRITE_TOOLS = ["Write", "Edit", "NotebookEdit"];

export function claudeAgent(account: Account, choice: Choice): AgentAdapter {
  return {
    guarded: true,
    async run(job) {
      const canWrite = job.lane.agent?.access === "write";
      // the hook runs this same program, so the guard is the one the tests cover
      const guard = `${quote(process.execPath)} ${quote(process.argv[1] ?? "")} guard`;
      const hooks = { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: guard }] }] };
      const tools = [...READ_TOOLS, ...(canWrite ? WRITE_TOOLS : [])].join(",");
      const args = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        ...(choice.model ? ["--model", choice.model] : []),
        ...(choice.effort ? ["--effort", choice.effort] : []),
        "--add-dir",
        job.laneDir,
        "--settings",
        JSON.stringify({ hooks }),
        "--tools", // the only tools there are for this run
        tools,
        "--allowedTools", // and they need no approval: nobody is there to give one
        tools,
      ]; // never --bare: it skips hooks, so the guard would not run. And no permission mode that skips checks.
      const env = profileEnv("CLAUDE_CONFIG_DIR", account.profile, ".claude");
      const out = await runCli(job, account.bin ?? "claude", args, env, true);

      const result = out.events.findLast((e) => e.type === "result");
      const text = typeof result?.result === "string" ? result.result : "";
      const usage = (result?.usage ?? {}) as Record<string, unknown>;
      const tokens = [
        "input_tokens",
        "output_tokens",
        "cache_read_input_tokens",
        "cache_creation_input_tokens",
      ].reduce((sum, key) => sum + (Number(usage[key]) || 0), 0);
      let error: string | undefined;
      if (result?.is_error) {
        const listed = Array.isArray(result.errors) ? result.errors.join(" ") : "";
        error = text || listed || String(result.subtype ?? "the run ended in an error");
      } else if (out.exitCode !== 0) error = out.stderr || `claude exited ${out.exitCode}`;
      else handoffFromText(job, text);
      return {
        exitCode: out.exitCode,
        usage: { tokens, usd: Number(result?.total_cost_usd) || 0 },
        sessionId: typeof result?.session_id === "string" ? result.session_id : undefined,
        error,
        limit: error !== undefined && LIMIT.test(error),
        streamPath: out.streamPath,
      };
    },
  };
}
