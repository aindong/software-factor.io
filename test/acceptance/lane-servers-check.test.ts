// A workflow declares a profile server, optionally under the profile's own name; a lane's agent
// names it; the checker reports a name that is not declared and a profile server no lane names.
import { describe, expect, it } from "vitest";
import { edit } from "../helpers/collect.ts";
import { agentLane, flowRepo } from "../helpers/repo.ts";

const repo = flowRepo({ lanes: [agentLane("look")] });
const agentOf = (w: { lanes: unknown[] }) => (w.lanes[0] as { agent: Record<string, unknown> }).agent;
const check = (
  change: (w: Record<string, unknown> & { lanes: { agent: Record<string, unknown> }[] }) => void,
) => {
  edit(repo, change as never);
  const r = repo.sf("check");
  return { ok: r.status === 0, text: r.stdout + r.stderr };
};

describe("profile servers in a workflow", () => {
  it("accepts a profile server, with or without the profile's name for it, named by a lane", () => {
    const r = check((w) => {
      w.mcp = { docs: { from: "profile" }, tracker: { from: "profile", name: "claude.ai Tracker" } };
      agentOf(w).servers = ["docs", "tracker"];
    });
    expect(r.ok, r.text).toBe(true);
  });

  it("accepts * for skills and for servers", () => {
    const r = check((w) => {
      w.mcp = { docs: { from: "profile" } };
      w.skills = { "my-plugin:plan": { from: "profile" } };
      agentOf(w).servers = ["*"];
      agentOf(w).skills = ["*"];
    });
    expect(r.ok, r.text).toBe(true);
  });

  it("reports a lane that names a server the workflow does not declare", () => {
    const r = check((w) => {
      w.mcp = undefined;
      agentOf(w).servers = ["docs"];
    });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/lanes\[0\]\.agent\.servers/);
    expect(r.text).toContain('MCP server "docs" is not declared');
  });

  it("reports a profile server that no lane names", () => {
    const r = check((w) => {
      w.mcp = { docs: { from: "profile" }, spare: { from: "profile" } };
      agentOf(w).servers = ["docs"];
    });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/mcp\.spare/);
    expect(r.text).toContain('"spare"');
    expect(r.text).not.toMatch(/mcp\.docs/);
  });

  it("does not report a profile server when a lane names *", () => {
    const r = check((w) => {
      w.mcp = { docs: { from: "profile" }, spare: { from: "profile" } };
      agentOf(w).servers = ["*"];
    });
    expect(r.ok, r.text).toBe(true);
  });

  it("refuses a name that is empty, and keys the schema knows nothing of", () => {
    expect(
      check((w) => {
        w.mcp = { docs: { from: "profile", name: "" } };
        agentOf(w).servers = ["docs"];
      }).ok,
    ).toBe(false);
    expect(
      check((w) => {
        w.mcp = { docs: { from: "profile", url: "x" } };
        agentOf(w).servers = ["docs"];
      }).ok,
    ).toBe(false);
  });

  it("refuses two servers that become one tool prefix, and one called factor in tool names", () => {
    const clash = check((w) => {
      w.mcp = { one: { from: "profile", name: "a.b" }, two: { from: "profile", name: "a b" } };
      agentOf(w).servers = ["one", "two"];
    });
    expect(clash.ok).toBe(false);
    expect(clash.text).toContain("mcp__a_b__");
    const factor = check((w) => {
      w.mcp = { docs: { from: "profile", name: "fac.tor" } };
      agentOf(w).servers = ["docs"];
    });
    expect(factor.ok).toBe(true);
    const own = check((w) => {
      w.mcp = { docs: { from: "profile", name: "factor" } };
      agentOf(w).servers = ["docs"];
    });
    expect(own.ok).toBe(false);
    expect(own.text).toContain("factory's own server");
  });

  it("refuses a lane that names a server the profile does not hold", () => {
    const r = check((w) => {
      w.mcp = { docs: { from: "command", command: "x" } };
      agentOf(w).servers = ["docs"];
    });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("does not come from the agent's profile");
  });

  it("refuses a declared name that would be the wildcard, or whose tool names cannot be read", () => {
    const star = check((w) => {
      w.mcp = { docs: { from: "profile", name: "*" } };
      agentOf(w).servers = ["docs"];
    });
    expect(star.ok).toBe(false);
    expect(star.text).toContain("mcp.docs");
    const skill = check((w) => {
      w.mcp = undefined;
      w.skills = { review: { from: "repo", source: "acme/skills", skill: "*" } };
      agentOf(w).servers = undefined;
      agentOf(w).skills = ["review"];
    });
    expect(skill.ok).toBe(false);
    expect(skill.text).toContain("skills.review");
    for (const name of ["docs.", "docs_", "x (dev)"]) {
      const odd = check((w) => {
        w.skills = undefined;
        w.mcp = { docs: { from: "profile", name } };
        agentOf(w).skills = undefined;
        agentOf(w).servers = ["docs"];
      });
      expect(odd.ok, name).toBe(false);
      expect(odd.text, name).toContain("mcp.docs");
    }
  });
});
