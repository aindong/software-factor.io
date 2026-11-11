// A lane that names no skill and no server is started with the arguments it always had; a lane that
// names skills also gets the Skill tool, and the guard is told which skills.
import { describe, expect, it } from "vitest";
import { claudeArgs } from "../../src/core/agents/claude-args.ts";
import type { AgentJob } from "../../src/core/agents/types.ts";

const job = (extra: Partial<AgentJob> = {}, access = "write") =>
  ({
    runId: "r1",
    lane: { id: "build", agent: { role: "author", access, prompt: "x" } },
    cwd: "/w",
    laneDir: "/l",
    server: ["node", "/x/cli.js", "mcp", "--lane", "build"],
    protect: ["main"],
    ...extra,
  }) as unknown as AgentJob;
const SELF = ["/bin/x", "guard"];
const hook = (command: string) => ({
  hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command }] }] },
});
const FACTOR = ["memory_read", "memory_note", "handoff_write", "ask_question", "evidence_attach"]
  .map((t) => `mcp__factor__${t}`)
  .join(",");
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

describe("the arguments of Claude Code for a lane", () => {
  it("are exactly the old ones for a lane that names no skill and no server", () => {
    const args = claudeArgs(job(), { model: "opus", effort: "high" }, SELF, undefined);
    expect(args).toEqual([
      ...["-p", "--output-format", "stream-json", "--verbose", "--model", "opus", "--effort", "high"],
      ...["--add-dir", "/l"],
      "--settings",
      JSON.stringify(
        hook(
          "'/bin/x' 'guard' '--worktree' '/w' '--lane-dir' '/l' '--access' 'write' '--protect' 'main' || exit 2",
        ),
      ),
      ...["--setting-sources", "user", "--strict-mcp-config"],
      "--mcp-config",
      JSON.stringify({
        mcpServers: { factor: { command: "node", args: ["/x/cli.js", "mcp", "--lane", "build"] } },
      }),
      ...["--tools", "Read,Glob,Grep,Bash,Write,Edit,NotebookEdit"],
      ...["--allowedTools", `Read,Glob,Grep,Bash,Write,Edit,NotebookEdit,${FACTOR}`],
    ]);
  });

  it("are the same when the lane lists empty skills and servers", () => {
    const plain = claudeArgs(job(), {}, SELF, undefined);
    expect(claudeArgs(job({ skills: [], servers: [] }), {}, SELF, ["a", "b"])).toEqual(plain);
  });

  it("add the Skill tool to the tools and the allowed tools for a lane that names skills", () => {
    const args = claudeArgs(job({ skills: ["my-plugin:plan"] }, "read"), {}, SELF, undefined);
    expect(flag(args, "--tools")).toBe("Read,Glob,Grep,Bash,Skill");
    expect(flag(args, "--allowedTools")).toBe(`Read,Glob,Grep,Bash,Skill,${FACTOR}`);
    expect(args).toContain("--strict-mcp-config"); // no server named: still sealed
    expect(args).not.toContain("--disallowedTools");
  });

  it("tell the guard the skills on its command line, where the agent cannot change them", () => {
    const args = claudeArgs(job({ skills: ["my-plugin:plan", "*"] }), {}, SELF, undefined);
    const settings = JSON.parse(flag(args, "--settings") ?? "{}");
    const command = settings.hooks.PreToolUse[0].hooks[0].command as string;
    expect(command).toContain("'--skill' 'my-plugin:plan' '--skill' '*'");
    expect(command.endsWith("|| exit 2")).toBe(true);
  });
});
