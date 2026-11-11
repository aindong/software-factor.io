// The hook command of a lane, taken out of the arguments Claude Code is started with and run
// through the real guard command, as the CLI runs it.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { claudeArgs } from "../../src/core/agents/claude-args.ts";
import type { AgentJob } from "../../src/core/agents/types.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "sf-hook-")));
mkdirSync(join(root, "wt"));
mkdirSync(join(root, "lane"));

/** Runs the lane's hook on one tool call. Returns the exit code the CLI would see. */
export function hookFor(lane: { skills?: string[]; servers?: string[] }, others?: string[]) {
  const job = {
    runId: "r",
    lane: { id: "x", agent: { role: "r", access: "read", prompt: "p" } },
    cwd: join(root, "wt"),
    laneDir: join(root, "lane"),
    server: ["node", "x"],
    ...lane,
  } as unknown as AgentJob;
  const args = claudeArgs(job, {}, [process.execPath, resolve("src/cli.ts"), "guard"], others);
  const settings = JSON.parse(args[args.indexOf("--settings") + 1] ?? "{}");
  const command: string = settings.hooks.PreToolUse[0].hooks[0].command;
  return (tool_name: unknown, tool_input: unknown) =>
    spawnSync("sh", ["-c", command], { input: JSON.stringify({ tool_name, tool_input }), encoding: "utf8" })
      .status;
}
