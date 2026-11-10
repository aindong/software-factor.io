// Claude Code, run for one lane: print mode with a JSON stream, the account's profile folder, and
// the factory's guard as a hook before every tool call (docs/research/agent-clis.md).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Account } from "../accounts.ts";
import { type Choice, handoffFromText, LIMIT, profileEnv, quote, runCli } from "./cli.ts";
import type { AgentAdapter } from "./types.ts";

/** The settings files of a profile folder, as one text. */
function settingsOf(profile: string | undefined): string {
  return ["settings.json", "settings.local.json"]
    .map((name) => {
      const file = join(profile ?? "", name);
      return existsSync(file) ? readFileSync(file, "utf8") : "";
    })
    .join("\0");
}

// A lane that only reads has no tool that writes files: it gives its hand-off in its last message.
const READ_TOOLS = ["Read", "Glob", "Grep", "Bash"];
const WRITE_TOOLS = ["Write", "Edit", "NotebookEdit"];

export function claudeAgent(account: Account, choice: Choice): AgentAdapter {
  return {
    guarded: true,
    async run(job) {
      const canWrite = job.lane.agent?.access === "write";
      // The hook runs this same program, so the guard is the one the tests cover. The lane is on
      // its command line, where the agent cannot change it. A CLI lets a call through when its hook
      // breaks (any exit code but 2), so every failure of the guard to run is turned into a denial.
      const lane = [
        ...["--worktree", job.cwd, "--lane-dir", job.laneDir],
        ...["--access", canWrite ? "write" : "read"],
        ...(job.protect ?? []).flatMap((branch) => ["--protect", branch]),
      ];
      // with an empty environment: the CLI's settings can set variables for hooks, and one such as
      // NODE_OPTIONS would decide what the guard loads
      const self = ["/usr/bin/env", "-i", process.execPath, process.argv[1] ?? "", "guard", ...lane];
      const guard = `${self.map(quote).join(" ")} || exit 2`;
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
        // the worktree is the agent's to write: its settings, hooks and MCP servers are not loaded
        "--setting-sources",
        "user",
        "--strict-mcp-config",
        "--tools", // the only tools there are for this run
        tools,
        "--allowedTools", // and they need no approval: nobody is there to give one
        tools,
      ]; // never --bare: it skips hooks, so the guard would not run. And no permission mode that skips checks.
      const env = profileEnv("CLAUDE_CONFIG_DIR", account.profile, ".claude");
      const settingsBefore = settingsOf(account.profile);
      const out = await runCli(job, account.bin ?? "claude", args, env, true);
      // the profile's settings are loaded by every later lane, and can turn hooks off
      const tampered =
        settingsOf(account.profile) === settingsBefore
          ? undefined
          : `the settings in the profile folder of this account changed while lane "${job.lane.id}" worked: look at ${account.profile}/settings.json before the next run`;

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
        tampered,
      };
    },
  };
}
