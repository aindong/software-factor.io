import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addLane, connect, removeLane, renameLane, updateLane } from "../../src/core/floor/edit.ts";
import { parseWorkflow } from "../../src/core/schema/parse.ts";

type Json = Record<string, unknown>;
const frozen = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) {
    for (const v of Object.values(value)) frozen(v);
    Object.freeze(value);
  }
  return value;
};
const start = (file = "workflows/alleo-loop.json") => frozen(JSON.parse(readFileSync(file, "utf8")) as Json);
const lanes = (w: Json) => w.lanes as (Json & { id: string; on: Record<string, unknown> })[];
const lane = (w: Json, id: string) => lanes(w).find((l) => l.id === id);
const problems = (w: Json) => parseWorkflow(w).problems.map((p) => `${p.path}: ${p.message}`);

describe("adding a lane", () => {
  it("puts a lane of the chosen kind after the one named, with an id nothing else has", () => {
    const w = addLane(start(), { after: "plan", kind: "agent" });
    const ids = lanes(w).map((l) => l.id);
    expect(ids.indexOf("lane")).toBe(ids.indexOf("plan") + 1);
    const again = addLane(w, { after: "lane", kind: "command" });
    expect(lanes(again).map((l) => l.id)).toContain("lane-2");
  });

  it("gives a workflow the checker accepts for an agent lane, and names what a command lane still needs", () => {
    expect(problems(addLane(start(), { kind: "agent" }))).toEqual([]);
    const withCommand = problems(addLane(start(), { kind: "command" }));
    expect(withCommand.length).toBeGreaterThan(0); // it has no command yet: the checker says so, the edit does not guess one
  });

  it("puts it at the end when no lane is named", () => {
    expect(lanes(addLane(start(), { kind: "wait" })).at(-1)?.id).toBe("lane");
  });
});

describe("removing a lane", () => {
  it("takes it out and sends the lines that came to it on to where it passed to", () => {
    const before = start();
    const next = lane(before, "impact")?.on.pass;
    const w = removeLane(before, "impact");
    expect(lane(w, "impact")).toBeUndefined();
    expect(JSON.stringify(w)).not.toContain('"to":"impact"');
    expect(JSON.stringify(lanes(w).map((l) => l.on))).not.toContain('"impact"');
    expect(typeof next).toBe("string");
    expect(JSON.stringify(lane(w, "build")?.on)).toContain(String(next));
  });

  it("leaves a workflow with one lane as it is", () => {
    const one = frozen({ ...start(), lanes: [lanes(start())[0]] });
    expect(removeLane(one, lanes(one)[0]?.id ?? "")).toBe(one);
  });
});

describe("renaming a lane", () => {
  it("changes its id and every name that pointed at it: targets, inputs, conditions", () => {
    const w = renameLane(start(), "review", "inspect");
    expect(lane(w, "inspect")).toBeDefined();
    expect(lane(w, "review")).toBeUndefined();
    const text = JSON.stringify(w);
    expect(text).not.toMatch(/"review"/);
    expect(text).not.toMatch(/"review\.(outputs|gates)\./);
    expect(problems(w)).toEqual([]);
  });

  it("refuses an id that is taken or that is not an id", () => {
    const w = start();
    expect(renameLane(w, "review", "build")).toBe(w);
    expect(renameLane(w, "review", "Not An Id")).toBe(w);
  });
});

describe("connecting an outcome", () => {
  it("points the outcome at the target", () => {
    const w = connect(
      start("workflows/research-only.json"),
      lanes(start("workflows/research-only.json"))[0]?.id ?? "",
      "fail",
      "@drop",
    );
    expect(lanes(w)[0]?.on.fail).toBe("@drop");
  });

  it("gives a connection that points back a round limit and a way out", () => {
    const w = connect(start(), "ship", "fail", "build");
    expect(lane(w, "ship")?.on.fail).toEqual([{ to: "build", maxRounds: 2 }, { to: "@stop" }]);
    expect(problems(w)).toEqual([]);
  });

  it("also treats a lane's connection to itself as pointing back", () => {
    const w = connect(start(), "build", "fail", "build");
    expect(lane(w, "build")?.on.fail).toEqual([{ to: "build", maxRounds: 2 }, { to: "@stop" }]);
  });

  it("does nothing for a target that does not exist", () => {
    const w = start();
    expect(connect(w, "build", "pass", "nowhere")).toBe(w);
  });
});

describe("changing a lane's settings", () => {
  it("sets the fields given, drops the ones set to nothing, and keeps the rest", () => {
    const w = updateLane(start(), "build", { name: "Build it", checkpoint: "in", limits: undefined });
    expect(lane(w, "build")).toMatchObject({ name: "Build it", checkpoint: "in" });
    expect(lane(w, "build")).not.toHaveProperty("limits");
    expect(lane(w, "build")?.agent).toEqual(lane(start(), "build")?.agent);
  });

  it("changes the agent's settings one at a time", () => {
    const w = updateLane(start(), "build", { agent: { tier: "small" } });
    expect((lane(w, "build")?.agent as Json).tier).toBe("small");
    expect((lane(w, "build")?.agent as Json).role).toBe((lane(start(), "build")?.agent as Json).role);
  });
});

describe("every edit", () => {
  it("returns a new workflow and leaves the one it was given unchanged", () => {
    const w = start(); // frozen all the way down: an edit that wrote to it would throw
    for (const next of [
      addLane(w, { kind: "agent" }),
      removeLane(w, "impact"),
      renameLane(w, "review", "inspect"),
      connect(w, "ship", "fail", "build"),
      updateLane(w, "build", { name: "x" }),
    ]) {
      expect(next).not.toBe(w);
    }
    expect(lane(w, "review")).toBeDefined();
  });
});
