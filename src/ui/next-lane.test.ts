import { describe, expect, it } from "vitest";
import type { Workflow } from "../core/schema/workflow.ts";
import { nextStop } from "./next-lane.ts";

const lane = (id: string, name: string, pass: unknown) => ({ id, name, on: { pass, fail: "@stop" } });
const workflow = {
  lanes: [
    lane("plan", "Plan", "build"),
    lane("build", "Build", [{ to: "ship", when: { ref: "change.tier", in: ["low"] } }, { to: "review" }]),
    lane("review", "Review", "@done"),
    lane("ship", "Ship it", [{ to: "@done" }]),
    lane("odd", "Odd", "@inbox"),
  ],
} as unknown as Workflow;
const after = (at: string) => ({ lane: at, kind: "approval", decisions: ["approve", "reject", "send-back"] });
const before = (at: string) => ({ lane: at, kind: "approval", decisions: ["approve", "reject"] });

describe("what approving starts", () => {
  it("names the lane the pass route leads to", () => {
    expect(nextStop(workflow, after("plan"))).toBe("Build starts");
  });
  it("names the lane that has not run when the approval is before it", () => {
    expect(nextStop(workflow, before("ship"))).toBe("Ship it starts");
  });
  it("says the run ends done when the pass route ends it", () => {
    expect(nextStop(workflow, after("review"))).toBe("the run ends done");
    expect(nextStop(workflow, after("ship"))).toBe("the run ends done");
  });
  it("says nothing when the route depends on a condition, leads elsewhere or is not known", () => {
    expect(nextStop(workflow, after("build"))).toBeUndefined();
    expect(nextStop(workflow, after("odd"))).toBeUndefined();
    expect(nextStop(workflow, after("gone"))).toBeUndefined();
    expect(nextStop(undefined, after("plan"))).toBeUndefined();
  });
  it("says nothing for a question", () => {
    expect(nextStop(workflow, { lane: "plan", kind: "question", decisions: ["answer"] })).toBeUndefined();
  });
});
