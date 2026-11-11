// The lane's prompt names the skills and the servers the agent may use, and says nothing of them
// on a lane that has none.
import { describe, expect, it } from "vitest";
import { reachSection } from "../../src/core/engine/reach.ts";

const workflow = {
  mcp: { docs: { from: "profile" }, tracker: { from: "profile", name: "claude.ai Tracker" } },
  skills: { "my-plugin:plan": { from: "profile" } },
};
const lane = (agent: Record<string, unknown>) => ({ id: "look", agent: { role: "r", access: "read", ...agent } });
const section = (agent: Record<string, unknown>) =>
  reachSection(workflow as never, lane(agent) as never);

describe("what the prompt says of skills and servers", () => {
  it("names each skill and each server of the lane", () => {
    const text = section({ skills: ["my-plugin:plan"], mcp: ["docs", "tracker"] });
    expect(text).toContain("my-plugin:plan");
    expect(text).toContain("docs");
    expect(text).toContain("claude.ai Tracker"); // the profile's name for it, which the agent sees
  });

  it("says nothing on a lane that has none", () => {
    expect(section({})).toBe("");
    expect(section({ skills: [], mcp: [] })).toBe("");
    expect(section({ mcp: ["not-declared"] })).toBe("");
  });

  it("says only what the lane has", () => {
    const skills = section({ skills: ["my-plugin:plan"] });
    expect(skills).toContain("my-plugin:plan");
    expect(skills.toLowerCase()).not.toContain("server");
    expect(section({ mcp: ["docs"] }).toLowerCase()).not.toContain("skill");
  });

  it("says what * means", () => {
    expect(section({ skills: ["*"] })).toMatch(/any skill/i);
    expect(section({ mcp: ["*"] })).toMatch(/any (MCP )?server/i);
  });
});
