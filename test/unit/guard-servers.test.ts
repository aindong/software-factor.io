// The guard allows a tool of a server the lane names, denies a tool of any other MCP server, and
// still allows the factory's own tools on every lane.
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { judge } from "../../src/core/agents/guard.ts";
import { judgeReach } from "../../src/core/agents/reach.ts";
import { hookFor } from "../helpers/hook.ts";

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

describe("the guard as the hook of a lane's arguments", () => {
  const exits = (servers: string[] | undefined, tool: string, others?: string[]) =>
    hookFor(servers ? { servers } : {}, others)(tool, {});

  it("exits 0 for a tool of a named server and for the factory's own tools", () => {
    expect(exits(["docs"], "mcp__docs__search")).toBe(0);
    expect(exits(undefined, "mcp__factor__handoff_write")).toBe(0);
    expect(exits(["docs"], "mcp__factor__memory_read")).toBe(0);
  });

  it("exits 2 for a server the lane does not name, and for every server on a lane that names none", () => {
    expect(exits(["docs"], "mcp__tracker__list")).toBe(2);
    expect(exits(undefined, "mcp__docs__search")).toBe(2);
    expect(exits([], "mcp__docs__search")).toBe(2);
  });

  it("exits 2 for a server whose name only starts like a named one", () => {
    expect(exits(["My Server"], "mcp__My_Server__dev___x")).toBe(2); // the server "My Server (dev)"
    expect(exits(["My Server"], "mcp__My_Server__search")).toBe(0);
    expect(exits(["docs"], "mcp__docs_private__x")).toBe(2);
    expect(exits(["named"], "mcp__namedX__t")).toBe(2);
    expect(exits(["named"], "mcp__named")).toBe(2);
  });

  it("exits 2 for a tool the factory's server does not have, also for *", () => {
    expect(exits(undefined, "mcp__factor__anything_else")).toBe(2);
    expect(exits(["*"], "mcp__factor__anything_else")).toBe(2);
  });

  it("refuses to build a lane where two names become one tool prefix, or one is called factor", () => {
    const build = (servers: string[], others: string[]) => () => hookFor({ servers }, others);
    expect(build(["a.b"], ["a.b", "a b"])).toThrow(/both become "mcp__a_b__"/);
    expect(build(["a.b", "a b"], [])).toThrow(/both become/);
    expect(build(["factor"], ["factor"])).toThrow(/factor/);
    expect(build(["a.b"], ["a.b", "other"])).not.toThrow();
  });
});

describe("a server whose name ends in an odd character", () => {
  it("is not read as another server with a tool that starts with _", () => {
    expect(judgeReach("mcp__docs___search", {}, [], ["docs"])?.allow).toBe(false);
    expect(judgeReach("mcp__docs___search", {}, [], ["docs."])?.allow).toBe(false);
    expect(judgeReach("mcp__docs_search", {}, [], ["docs"])?.allow).toBe(false);
  });

  it("is refused when named or listed, with a plain message", () => {
    const build = (servers: string[], others: string[]) => () => hookFor({ servers }, others);
    expect(build(["docs."], ["docs."])).toThrow(/ends in _|"__"/);
    expect(build(["docs"], ["docs", "docs_"])).toThrow(/docs_/);
    expect(build(["docs"], ["docs", "x (dev)"])).toThrow(/x \(dev\)/);
  });
});

describe("a profile that cannot be listed", () => {
  const build = (servers: string[]) => () => hookFor({ servers }, null);
  it("starts a lane only when every server it names maps to itself", () => {
    expect(build(["docs", "my-db_2"])).not.toThrow();
    expect(build(["my db"])).toThrow(/could not be listed/);
    expect(build(["my.db"])).toThrow(/could not be listed/);
  });
  it("does not start a lane that names *", () => {
    expect(build(["*"])).toThrow(/could not be listed/);
  });
});

describe("a profile that lists a server called factor", () => {
  it("does not start a lane that names servers, and says to rename or remove it there", () => {
    expect(() => hookFor({ servers: ["docs"] }, ["docs", "factor"])).toThrow(/rename or remove/);
    expect(() => hookFor({ servers: ["docs"] }, ["docs", "fac.tor"])).not.toThrow();
  });
});
