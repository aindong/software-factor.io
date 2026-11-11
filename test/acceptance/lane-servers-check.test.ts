// A workflow declares a profile server, optionally under the profile's own name; a lane's agent
// names it; the checker reports a name that is not declared and a profile server no lane names.
import { describe, expect, it } from "vitest";
import { edit } from "../helpers/collect.ts";
import { agentLane, flowRepo } from "../helpers/repo.ts";

const repo = flowRepo({ lanes: [agentLane("look")] });
const check = (change: (w: Record<string, unknown> & { lanes: { agent: Record<string, unknown> }[] }) => void) => {
  edit(repo, change as never);
  const r = repo.sf("check");
  return { ok: r.status === 0, text: r.stdout + r.stderr };
};

describe("profile servers in a workflow", () => {
  it("accepts a profile server, with or without the profile's name for it, named by a lane", () => {
    const r = check((w) => {
      w.mcp = { docs: { from: "profile" }, tracker: { from: "profile", name: "claude.ai Tracker" } };
      w.lanes[0]!.agent.mcp = ["docs", "tracker"];
    });
    expect(r.ok, r.text).toBe(true);
  });

  it("accepts * for skills and for servers", () => {
    const r = check((w) => {
      w.mcp = { docs: { from: "profile" } };
      w.skills = { "my-plugin:plan": { from: "profile" } };
      w.lanes[0]!.agent.mcp = ["*"];
      w.lanes[0]!.agent.skills = ["*"];
    });
    expect(r.ok, r.text).toBe(true);
  });

  it("reports a lane that names a server the workflow does not declare", () => {
    const r = check((w) => {
      w.mcp = undefined;
      w.lanes[0]!.agent.mcp = ["docs"];
    });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/lanes\[0\]\.agent\.mcp/);
    expect(r.text).toContain('MCP server "docs" is not declared');
  });

  it("reports a profile server that no lane names", () => {
    const r = check((w) => {
      w.mcp = { docs: { from: "profile" }, spare: { from: "profile" } };
      w.lanes[0]!.agent.mcp = ["docs"];
    });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/mcp\.spare/);
    expect(r.text).toContain('"spare"');
    expect(r.text).not.toMatch(/mcp\.docs/);
  });

  it("does not report a profile server when a lane names *", () => {
    const r = check((w) => {
      w.mcp = { docs: { from: "profile" }, spare: { from: "profile" } };
      w.lanes[0]!.agent.mcp = ["*"];
    });
    expect(r.ok, r.text).toBe(true);
  });

  it("refuses a name that is empty, and keys the schema knows nothing of", () => {
    expect(check((w) => { w.mcp = { docs: { from: "profile", name: "" } }; w.lanes[0]!.agent.mcp = ["docs"]; }).ok).toBe(false);
    expect(check((w) => { w.mcp = { docs: { from: "profile", url: "x" } }; w.lanes[0]!.agent.mcp = ["docs"]; }).ok).toBe(false);
  });
});
