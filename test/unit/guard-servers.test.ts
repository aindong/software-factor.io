// The guard allows a tool of a server the lane names, denies a tool of any other MCP server, and
// still allows the factory's own tools on every lane.
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { judge } from "../../src/core/agents/guard.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "sf-guard-server-")));
const worktree = join(root, "wt");
const laneDir = join(root, "lane");
mkdirSync(worktree);
mkdirSync(laneDir);
const call = (tool: unknown, servers?: string[]) =>
  judge(
    { tool, input: {} },
    { worktree, laneDir, access: "read", defaultBranch: "main", ...(servers ? { servers } : {}) },
  );

describe("the guard and the tools of MCP servers", () => {
  it("allows a tool of a server the lane names", () => {
    expect(call("mcp__docs__search", ["docs"])).toEqual({ allow: true });
    expect(call("mcp__docs__a_b-c", ["tracker", "docs"]).allow).toBe(true);
  });

  it("denies a tool of any other server", () => {
    expect(call("mcp__tracker__list", ["docs"]).allow).toBe(false);
  });

  it("denies every server on a lane that names none", () => {
    expect(call("mcp__docs__search").allow).toBe(false);
    expect(call("mcp__docs__search", []).allow).toBe(false);
  });

  it("never matches by prefix alone: docs is not docs_private", () => {
    expect(call("mcp__docs_private__read", ["docs"]).allow).toBe(false);
    expect(call("mcp__docs__x__read", ["docs"]).allow).toBe(false); // a server called docs__x
    expect(call("mcp__doc__read", ["docs"]).allow).toBe(false);
    expect(call("mcp__docs", ["docs"]).allow).toBe(false); // no tool
    expect(call("mcp__docs__", ["docs"]).allow).toBe(false);
    expect(call("mcpdocs__x", ["docs"]).allow).toBe(false);
  });

  it("matches a server by the name Claude Code gives it", () => {
    expect(call("mcp__claude_ai_Gmail__search", ["claude.ai Gmail"]).allow).toBe(true);
    expect(call("mcp__claude_ai_Gmail__search", ["claude_ai_Gmail"]).allow).toBe(true);
    expect(call("mcp__claude_ai_Drive__search", ["claude.ai Gmail"]).allow).toBe(false);
  });

  it("allows any server's tool for *, but only a tool it can read", () => {
    expect(call("mcp__anything__do", ["*"]).allow).toBe(true);
    expect(call("mcp__nothing", ["*"]).allow).toBe(false);
    expect(call("mcp____x", ["*"]).allow).toBe(false);
  });

  it("denies a tool name it cannot read", () => {
    for (const tool of [undefined, 3, "", null, ["mcp__docs__x"]]) {
      expect(call(tool, ["docs", "*"]).allow, String(tool)).toBe(false);
    }
  });

  it("still allows the factory's own tools on every lane", () => {
    for (const servers of [undefined, [], ["docs"], ["*"]]) {
      for (const tool of ["memory_read", "memory_note", "handoff_write", "ask_question", "evidence_attach"]) {
        expect(call(`mcp__factor__${tool}`, servers).allow, tool).toBe(true);
      }
    }
  });

  it("does not allow a tool the factory's server does not have, unless the lane names it", () => {
    expect(call("mcp__factor__memory_keep").allow).toBe(false);
    expect(call("mcp__factor__memory_keep", ["docs"]).allow).toBe(false);
  });
});
