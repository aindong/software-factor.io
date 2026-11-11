// Claude Code, run for one lane: print mode with a JSON stream, the account's profile folder, and
// the factory's guard as a hook before every tool call (docs/research/agent-clis.md).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Account } from "../accounts.ts";
import { claudeArgs } from "./claude-args.ts";
import { discoverServers } from "./claude-discover.ts";
import { type Choice, count, handoffFromText, LIMIT, profileEnv, runCli } from "./cli.ts";
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

export function claudeAgent(account: Account, choice: Choice): AgentAdapter {
  return {
    guarded: true,
    server: true,
    async run(job) {
      const env = profileEnv("CLAUDE_CONFIG_DIR", account.profile, ".claude");
      const bin = account.bin ?? "claude";
      const named = (job.servers ?? []).length > 0;
      // run outside the worktree: a server file the agent wrote there is not the profile's
      const others = named ? discoverServers(bin, env, job.runId, job.hostDir) : undefined;
      // with "claude mcp list" unreadable, the guard still holds the lane to the servers it names
      const notice =
        named && others === undefined
          ? 'the other servers of the profile could not be listed ("claude mcp list" failed or printed nothing readable), so they could not be shut out: the guard still denies their tools'
          : undefined;
      const self = ["/usr/bin/env", "-i", process.execPath, process.argv[1] ?? "", "guard"];
      const args = claudeArgs(job, choice, self, others);
      const settingsBefore = settingsOf(account.profile);
      const out = await runCli(job, bin, args, env, true);
      // the profile's settings are loaded by every later lane, and can turn hooks off
      const tampered =
        settingsOf(account.profile) === settingsBefore
          ? undefined
          : `the settings in the profile folder of this account changed while lane "${job.lane.id}" worked: look at ${account.profile}/settings.json before the next run`;

      const result = out.events.findLast((e) => e.type === "result");
      const text = typeof result?.result === "string" ? result.result : "";
      const usage = claudeUsage(out.events) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
      // the model that did most of the work, by the CLI's own account
      const models = Object.entries(
        (result?.modelUsage ?? {}) as Record<string, { costUSD?: unknown } | null>,
      );
      const costOf = (entry: (typeof models)[number]) => Number(entry[1]?.costUSD) || 0;
      const model = models.sort((x, y) => costOf(y) - costOf(x))[0]?.[0] ?? choice.model;
      const cost = result?.total_cost_usd;
      const costReported = typeof cost === "number" && Number.isFinite(cost) && cost >= 0;
      let error: string | undefined;
      let said: string | undefined;
      if (result?.is_error) {
        const listed = Array.isArray(result.errors) ? result.errors.join(" ") : "";
        error = text || listed || String(result.subtype ?? "the run ended in an error");
      } else if (out.exitCode !== 0) error = out.stderr || `claude exited ${out.exitCode}`;
      else said = handoffFromText(job, text);
      return {
        exitCode: out.exitCode,
        // a run that was cut off prints no result: what it used is then not known
        usage: result && {
          ...usage,
          tokens,
          usd: costReported ? (cost as number) : 0,
          costReported,
        },
        model,
        sessionId: typeof result?.session_id === "string" ? result.session_id : undefined,
        error,
        limit: error !== undefined && LIMIT.test(error),
        streamPath: out.streamPath,
        tampered,
        said,
        notice,
      };
    },
  };
}

/** The four kinds of tokens in the last result the CLI printed, or nothing when it printed none. */
export function claudeUsage(events: Record<string, unknown>[]) {
  const result = events.findLast((e) => e.type === "result");
  if (!result) return undefined;
  const used = (result.usage ?? {}) as Record<string, unknown>;
  return {
    input: count(used.input_tokens),
    output: count(used.output_tokens),
    cacheRead: count(used.cache_read_input_tokens),
    cacheWrite: count(used.cache_creation_input_tokens),
  };
}
