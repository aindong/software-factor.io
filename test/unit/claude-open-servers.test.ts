// A lane that names profile servers is started without --strict-mcp-config, with the factory's
// own server still given, the named servers allowed, and every other server of the profile shut out.
import { describe, expect, it } from "vitest";
import { claudeArgs } from "../../src/core/agents/claude-args.ts";
import type { AgentJob } from "../../src/core/agents/types.ts";

const job = (extra: Partial<AgentJob>) =>
  ({
    runId: "r1",
    lane: { id: "look", agent: { role: "author", access: "read", prompt: "x" } },
    cwd: "/w",
    laneDir: "/l",
    server: ["node", "/x/cli.js", "mcp"],
    ...extra,
  }) as unknown as AgentJob;
const SELF = ["/bin/x", "guard"];
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];
const list = (args: string[], name: string) => (flag(args, name) ?? "").split(",");

describe("the arguments for a lane that names profile servers", () => {
  const args = claudeArgs(job({ servers: ["docs"] }), {}, SELF, ["docs", "docs_private", "tracker"]);

  it("do not seal the servers, and still give the factory's own", () => {
    expect(args).not.toContain("--strict-mcp-config");
    const config = JSON.parse(flag(args, "--mcp-config") ?? "{}");
    expect(Object.keys(config.mcpServers)).toEqual(["factor"]);
    expect(args).toContain("--setting-sources");
  });

  it("allow the named server and the factory's tools", () => {
    const allowed = list(args, "--allowedTools");
    expect(allowed).toContain("mcp__docs");
    expect(allowed).toContain("mcp__factor__handoff_write");
    expect(allowed).not.toContain("mcp__tracker");
  });

  it("shut out every other server the profile lists, by exact name", () => {
    expect(list(args, "--disallowedTools")).toEqual(["mcp__docs_private", "mcp__tracker"]);
  });

  it("tell the guard the server on its command line", () => {
    const hook = JSON.parse(flag(args, "--settings") ?? "{}").hooks.PreToolUse[0].hooks[0].command;
    expect(hook).toContain("'--server' 'docs'");
  });

  it("use the name Claude Code gives: every character outside A-Za-z0-9_- becomes _", () => {
    const named = claudeArgs(job({ servers: ["claude.ai Gmail"] }), {}, SELF, [
      "claude.ai Gmail",
      "claude.ai Drive",
    ]);
    expect(list(named, "--allowedTools")).toContain("mcp__claude_ai_Gmail");
    expect(list(named, "--disallowedTools")).toEqual(["mcp__claude_ai_Drive"]);
  });

  it("shut out nothing for *, and allow every server the profile lists", () => {
    const all = claudeArgs(job({ servers: ["*"] }), {}, SELF, ["docs", "tracker"]);
    expect(all).not.toContain("--disallowedTools");
    expect(all).not.toContain("--strict-mcp-config");
    expect(list(all, "--allowedTools")).toEqual(expect.arrayContaining(["mcp__docs", "mcp__tracker"]));
  });

  it("never shut out the factory's own server", () => {
    const named = claudeArgs(job({ servers: ["docs"] }), {}, SELF, ["docs", "factor"]);
    expect(named).not.toContain("--disallowedTools");
  });

  it("shut out nothing when the profile's servers are not known, but still allow the named ones", () => {
    const blind = claudeArgs(job({ servers: ["docs"] }), {}, SELF, undefined);
    expect(blind).not.toContain("--disallowedTools");
    expect(blind).not.toContain("--strict-mcp-config");
    expect(list(blind, "--allowedTools")).toContain("mcp__docs");
  });

  it("add Skill as well when the lane also names skills", () => {
    const both = claudeArgs(job({ servers: ["docs"], skills: ["s"] }), {}, SELF, ["docs"]);
    expect(list(both, "--tools")).toContain("Skill");
  });
});
