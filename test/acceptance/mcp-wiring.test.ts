import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { judge } from "../../src/core/agents/guard.ts";
import { agentLane, bind, flag, flowRepo, standinAccount } from "../helpers/repo.ts";

const ok = { outcome: "pass", summary: "ok" };

describe("the server each CLI is given for one run", () => {
  const repo = flowRepo({
    lanes: [
      agentLane("build", { on: { pass: "review", fail: "@stop" } }),
      agentLane("review", { agent: { role: "reviewer" } }),
    ],
  });
  const claude = standinAccount(repo, "claude-a", "claude", { actions: [{ handoff: ok }] });
  const codex = standinAccount(repo, "codex-a", "codex", { actions: [{ final: ok }] });
  bind(repo, "author", "claude-a");
  bind(repo, "reviewer", "codex-a");
  repo.sf("run");
  const [run] = repo.rows<{ id: string }>("select id from runs");
  const lanePart = (args: string[], name: string) => args[args.indexOf(name) + 1];

  it("is given to Claude Code as its only MCP server, with the run and the lane on its command line", () => {
    const argv = claude.calls()[0]?.argv ?? [];
    const servers = JSON.parse(flag(argv, "--mcp-config") ?? "{}").mcpServers;
    expect(Object.keys(servers)).toEqual(["factor"]);
    expect(argv).toContain("--strict-mcp-config");
    const args: string[] = servers.factor.args;
    expect(args).toContain("mcp");
    expect(lanePart(args, "--run")).toBe(run?.id);
    expect(lanePart(args, "--lane")).toBe("build");
    expect(lanePart(args, "--account")).toBe("claude-a");
    expect(lanePart(args, "--workspace")).toBe(repo.dir);
    expect(lanePart(args, "--lane-dir")).toBe(claude.calls()[0]?.env.FACTOR_LANE_DIR);
  });

  it("has tools that need no approval on Claude Code", () => {
    const allowed = flag(claude.calls()[0]?.argv ?? [], "--allowedTools") ?? "";
    for (const tool of ["memory_read", "memory_note", "handoff_write", "ask_question", "evidence_attach"]) {
      expect(allowed).toContain(`mcp__factor__${tool}`);
    }
  });

  it("is given to Codex in its own way, for the review lane", () => {
    const argv = codex.calls()[0]?.argv ?? [];
    const setting = (key: string) => {
      const found = argv.find((a) => a.startsWith(`mcp_servers.factor.${key}=`)) ?? "";
      return JSON.parse(found.slice(found.indexOf("=") + 1) || "null");
    };
    expect(typeof setting("command")).toBe("string");
    const args: string[] = setting("args");
    expect(lanePart(args, "--run")).toBe(run?.id);
    expect(lanePart(args, "--lane")).toBe("review");
    expect(lanePart(args, "--account")).toBe("codex-a");
  });
});

describe("the guard and MCP tools", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sf-guard-mcp-")));
  const where = {
    worktree: root,
    laneDir: join(root, "lane"),
    access: "read" as const,
    defaultBranch: "main",
  };

  it("allows the factory's own tools, on a lane that only reads too", () => {
    for (const tool of ["memory_read", "memory_note", "handoff_write", "ask_question", "evidence_attach"]) {
      expect(judge({ tool: `mcp__factor__${tool}`, input: {} }, where)).toEqual({ allow: true });
    }
  });

  it("allows no other MCP tool, whatever it is called", () => {
    for (const tool of [
      "mcp__github__push_files",
      "mcp__factory__memory_read",
      "mcp__factor",
      "mcp__factor__",
    ]) {
      expect(judge({ tool, input: {} }, where).allow, tool).toBe(false);
    }
    expect(judge({ tool: "mcp__factor__memory_keep", input: {} }, where).allow).toBe(false);
  });
});
