// A run whose lane names a profile server that this machine has not allowed stops before the lane
// starts and says how to allow it; after `allow` the lane starts, held to what it names.
import { expect, it } from "vitest";
import { edit } from "../helpers/collect.ts";
import { runsOf } from "../helpers/plugin.ts";
import { agentLane, bind, flowRepo, hooksOf, pass, standinAccount } from "../helpers/repo.ts";

const LIST = "docs: npx docs-mcp - ✓ Connected\nother: https://example.com/mcp (HTTP) - ✓ Connected\n";

function setup(servers = ["docs"]) {
  const repo = flowRepo({
    lanes: [
      agentLane("look", { agent: { mcp: servers, skills: ["my-plugin:plan"] }, checkpoint: "out" }),
    ],
  });
  edit(repo, (w) => {
    w.mcp = { docs: { from: "profile" } };
    w.skills = { "my-plugin:plan": { from: "profile" } };
  });
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "name a server");
  const tool = (name: string, input: unknown = {}) => ({ tool: { name, input } });
  const profile = standinAccount(repo, "claude-a", "claude", {
    actions: [
      tool("mcp__docs__search"),
      tool("mcp__other__search"),
      tool("Skill", { skill: "my-plugin:plan" }),
      tool("Skill", { skill: "other:skill" }),
      pass(),
    ],
    mcpList: { out: LIST },
  });
  bind(repo, "author", "claude-a");
  return { repo, profile };
}

it("stops before the lane starts, and says to run softwarefactor allow docs", () => {
  const { repo, profile } = setup();
  const r = repo.sf("run");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/server "docs" .*is not allowed on this machine/);
  expect(r.stderr).toContain("softwarefactor allow docs");
  expect(profile.calls()).toEqual([]);
  expect(runsOf(repo)).toEqual([]);
});

it("records the approval in local.json, and then starts the lane with the server allowed", () => {
  const { repo, profile } = setup();
  const allowed = repo.sf("allow", "docs");
  expect(allowed.status, allowed.stderr).toBe(0);
  expect(typeof repo.json<{ servers: Record<string, string> }>(".factor/local.json").servers.docs).toBe(
    "string",
  );
  expect(repo.json<{ roles: unknown }>(".factor/local.json").roles).toBeTruthy(); // the rest is kept
  const r = repo.sf("run");
  expect(repo.rows("select status from runs"), r.stdout + r.stderr).toEqual([{ status: "done" }]);
  const [first] = profile.calls();
  const argv: string[] = first?.argv ?? [];
  expect(argv).not.toContain("--strict-mcp-config");
  expect(argv[argv.indexOf("--allowedTools") + 1]).toContain("mcp__docs");
  expect(argv[argv.indexOf("--disallowedTools") + 1]).toBe("mcp__other");
  // the guard, as the stand-in asks it: the named server and skill pass, the others do not
  expect(hooksOf(profile).map((h) => [h.tool, h.status])).toEqual([
    ["mcp__docs__search", 0],
    ["mcp__other__search", 2],
    ["Skill", 0],
    ["Skill", 2],
  ]);
  // and the prompt says what the lane may use
  expect(first?.stdin).toContain("my-plugin:plan");
  expect(first?.stdin).toContain("docs");
});

it("asks again when the workflow names another profile name for the server", () => {
  const { repo } = setup();
  expect(repo.sf("allow", "docs").status).toBe(0);
  edit(repo, (w) => {
    w.mcp = { docs: { from: "profile", name: "docs-two" } };
  });
  const r = repo.sf("run");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/server "docs" has changed since it was allowed/);
});

it("asks for its own approval when a lane names *", () => {
  const { repo } = setup(["*"]);
  const r = repo.sf("run");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("softwarefactor allow '*'");
  expect(repo.sf("allow", "*").status).toBe(0);
  const again = repo.sf("run");
  expect(repo.rows("select status from runs"), again.stdout + again.stderr).toEqual([{ status: "done" }]);
});

it("refuses to allow a server that no lane names or the workflow does not declare", () => {
  const { repo } = setup();
  const r = repo.sf("allow", "nothing");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/no MCP server "nothing"/);
});
