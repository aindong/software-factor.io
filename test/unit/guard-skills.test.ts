// The guard allows a Skill call only for a skill the lane names, or any skill for "*".
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { judge } from "../../src/core/agents/guard.ts";
import { hookFor } from "../helpers/hook.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "sf-guard-skill-")));
const worktree = join(root, "wt");
const laneDir = join(root, "lane");
mkdirSync(worktree);
mkdirSync(laneDir);
const skill = (input: unknown, skills?: string[]) =>
  judge(
    { tool: "Skill", input },
    { worktree, laneDir, access: "read", defaultBranch: "main", ...(skills ? { skills } : {}) },
  );

describe("the guard and the Skill tool", () => {
  it("denies Skill on a lane that names no skill", () => {
    expect(skill({ skill: "my-plugin:plan" }).allow).toBe(false);
    expect(skill({ skill: "my-plugin:plan" }, []).allow).toBe(false);
  });

  it("allows a skill the lane names, by its exact name", () => {
    expect(skill({ skill: "my-plugin:plan" }, ["my-plugin:plan"])).toEqual({ allow: true });
    expect(skill({ skill: "my-plugin:plan", args: "now" }, ["x", "my-plugin:plan"]).allow).toBe(true);
  });

  it("denies a skill the lane does not name, also one that only starts or ends the same", () => {
    expect(skill({ skill: "my-plugin:build" }, ["my-plugin:plan"]).allow).toBe(false);
    expect(skill({ skill: "my-plugin:plan-more" }, ["my-plugin:plan"]).allow).toBe(false);
    expect(skill({ skill: "plan" }, ["my-plugin:plan"]).allow).toBe(false);
    expect(skill({ skill: "/my-plugin:plan" }, ["my-plugin:plan"]).allow).toBe(false);
  });

  it("allows any skill for *", () => {
    expect(skill({ skill: "anything:at-all" }, ["*"]).allow).toBe(true);
  });

  it("denies a call whose skill name it cannot read, also for *", () => {
    for (const input of [{}, { skill: 7 }, { skill: "" }, { skill: ["a"] }, null, "plan"]) {
      expect(skill(input, ["*", "my-plugin:plan"]).allow, JSON.stringify(input)).toBe(false);
    }
  });

  it("does not let a lane's skills open anything but the Skill tool", () => {
    const where = { worktree, laneDir, access: "read" as const, defaultBranch: "main", skills: ["*"] };
    expect(judge({ tool: "Task", input: {} }, where).allow).toBe(false);
    expect(judge({ tool: "skill", input: { skill: "a" } }, where).allow).toBe(false);
  });
});

describe("the guard as the hook of a lane's arguments", () => {
  const exits = (skills: string[] | undefined, input: unknown) =>
    hookFor(skills ? { skills } : {})("Skill", input);

  it("exits 0 for a skill the lane names", () => {
    expect(exits(["allowed"], { skill: "allowed" })).toBe(0);
    expect(exits(["plugin:allowed"], { skill: "plugin:allowed" })).toBe(0);
    expect(exits(["*"], { skill: "any:thing" })).toBe(0);
  });

  it("exits 2 for any Skill call on a lane that names none", () => {
    expect(exits(undefined, { skill: "allowed" })).toBe(2);
    expect(exits([], { skill: "allowed" })).toBe(2);
  });

  it("exits 2 for a skill of another lane, and for every spelling that is not the same string", () => {
    for (const skill of [
      "plugin:allowed",
      "/allowed",
      "Allowed",
      "allowed ",
      " allowed",
      ["allowed"],
      1,
      undefined,
    ]) {
      expect(exits(["allowed"], { skill }), JSON.stringify(skill)).toBe(2);
    }
    expect(exits(["allowed"], {})).toBe(2);
    expect(exits(["allowed"], "allowed")).toBe(2);
  });
});
