// `claude mcp list` is read once for each run, with the account's profile. When it fails or prints
// nothing that can be read, the lane still starts with its named servers, and its record says that
// the other servers could not be shut out.
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeArgs } from "../../src/core/agents/claude-args.ts";
import { discoverServers, parseServers } from "../../src/core/agents/claude-discover.ts";
import { edit } from "../helpers/collect.ts";
import { agentLane, bind, flowRepo, pass, standinAccount } from "../helpers/repo.ts";

function bin(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "sf-mcp-list-"));
  const file = join(dir, "claude");
  const log = join(dir, "calls");
  writeFileSync(file, `#!/bin/sh\necho "$CLAUDE_CONFIG_DIR $@" >> "${log}"\n${body}\n`);
  chmodSync(file, 0o755);
  return { file, calls: () => readFileSync(log, "utf8").trim().split("\n") };
}
const OUT = [
  "Checking MCP server health...",
  "",
  "plugin:aikido:aikido-mcp: npx -y aikido - ✓ Connected",
  "claude.ai Gmail: https://gmail.example/mcp - ! Needs authentication",
  "docs: /usr/bin/docs-mcp --stdio - ✗ Failed to connect",
].join("\\n");

describe("reading the servers of a profile", () => {
  it("takes the name before the first colon and space of each line", () => {
    expect(parseServers(OUT.replaceAll("\\n", "\n"))).toEqual([
      "plugin:aikido:aikido-mcp",
      "claude.ai Gmail",
      "docs",
    ]);
  });

  it("finds nothing readable in empty text or in a line with no name", () => {
    expect(parseServers("")).toBeUndefined();
    expect(parseServers("No MCP servers configured.\n")).toBeUndefined();
  });

  it("runs the account's CLI with its profile, and reads the list once for each run", () => {
    const claude = bin(`printf '${OUT}\\n'`);
    const env = { CLAUDE_CONFIG_DIR: "/profile/a" };
    const first = discoverServers(claude.file, env, "run-1");
    expect(first).toEqual(["plugin:aikido:aikido-mcp", "claude.ai Gmail", "docs"]);
    expect(discoverServers(claude.file, env, "run-1")).toEqual(first);
    expect(claude.calls()).toEqual(["/profile/a mcp list"]);
    discoverServers(claude.file, env, "run-2");
    expect(claude.calls()).toHaveLength(2);
  });

  it("gives nothing when the CLI fails, prints nothing, or is not there", () => {
    expect(discoverServers(bin("echo oops >&2; exit 1").file, {}, "r")).toBeUndefined();
    expect(discoverServers(bin("exit 0").file, {}, "r")).toBeUndefined();
    expect(discoverServers("/nowhere/claude", {}, "r")).toBeUndefined();
  });
});

describe("a lane when the profile's servers cannot be listed", () => {
  for (const [why, mcpList] of [
    ["fails", { exit: 1 }],
    ["prints nothing", { out: "" }],
  ] as const) {
    it(`still starts with its named server when the list ${why}, and the record says so`, () => {
      const repo = flowRepo({ lanes: [agentLane("look", { agent: { servers: ["docs"] } })] });
      edit(repo, (w) => {
        w.mcp = { docs: { from: "profile" } };
      });
      repo.git("add", "-A");
      repo.git("commit", "-q", "-m", "name a server");
      const profile = standinAccount(repo, "claude-a", "claude", { actions: [pass()], mcpList });
      bind(repo, "author", "claude-a");
      expect(repo.sf("allow", "docs").status).toBe(0);
      const r = repo.sf("run");
      expect(repo.rows("select status from runs"), r.stdout + r.stderr).toEqual([{ status: "done" }]);
      const argv: string[] = profile.calls()[0]?.argv ?? [];
      expect(argv[argv.indexOf("--allowedTools") + 1]).toContain("mcp__docs");
      expect(argv).not.toContain("--strict-mcp-config");
      expect(argv).not.toContain("--disallowedTools");
      const events = repo.rows<{ data: string }>("select data from events where kind = 'lane.session'");
      expect(JSON.parse(events[0]?.data ?? "{}").notice).toMatch(/other servers .* could not be shut out/);
      expect(r.stdout).toMatch(/could not be shut out/);
    });
  }

  it("says nothing of it for a lane that names no server", () => {
    const repo = flowRepo({ lanes: [agentLane("look")] });
    const profile = standinAccount(repo, "claude-a", "claude", { actions: [pass()], mcpList: { exit: 1 } });
    bind(repo, "author", "claude-a");
    const r = repo.sf("run");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(profile.calls()[0]?.argv).toContain("--strict-mcp-config");
    const events = repo.rows<{ data: string }>("select data from events where kind = 'lane.session'");
    expect(JSON.parse(events[0]?.data ?? "{}").notice).toBeUndefined();
  });
});

describe("the names from a real print of claude mcp list", () => {
  const PRINT = [
    "Checking MCP server health…",
    "",
    "plugin:a:b: npx -y pkg mcp - ✓ Connected",
    "claude.ai Supabase: https://example.invalid/mcp - ✓ Connected",
    "rea: npx -y x mcp",
    "",
  ].join("\n");

  it("shuts out the servers a lane names neither of", () => {
    const names = parseServers(PRINT);
    expect(names).toEqual(["plugin:a:b", "claude.ai Supabase", "rea"]);
    const job = {
      runId: "r",
      lane: { id: "x", agent: { access: "read" } },
      cwd: "/w",
      laneDir: "/l",
      servers: ["rea"],
    };
    const args = claudeArgs(job as never, {}, ["g"], names);
    const shut = (args[args.indexOf("--disallowedTools") + 1] ?? "").split(",");
    expect(shut).toEqual(["mcp__plugin_a_b", "mcp__claude_ai_Supabase"]);
  });
});
