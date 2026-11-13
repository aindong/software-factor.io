// What Reject and Send back do, said before they are pressed, from the workflow's fail route (the engine
// takes the lane's fail route on a rejection, and runs the same lane again on a send-back).
import { describe, expect, it } from "vitest";
import type { Workflow } from "../../src/core/schema/workflow.ts";
import { consequenceWords } from "../../src/ui/next-lane.ts";

type Lane = Record<string, unknown>;
const lane = (id: string, more: Lane = {}): Lane => ({
  id,
  name: id[0]?.toUpperCase() + id.slice(1),
  uses: "core/command@1",
  checkpoint: "out",
  on: { pass: "@done", fail: "@stop" },
  ...more,
});
const flow = (...lanes: Lane[]) => ({ lanes }) as unknown as Workflow;
const after = { lane: "build", kind: "approval", decisions: ["approve", "reject", "send-back"] };
const before = { lane: "build", kind: "approval", decisions: ["approve", "reject"] };
const failing = (fail: unknown) => lane("build", { on: { pass: "@done", fail } });

describe("what Reject and Send back do", () => {
  it("says the run stops when the fail route stops it, and that the lane runs again on a send back", () => {
    expect(consequenceWords(flow(failing("@stop")), after)).toBe(
      "Reject: the run stops. Send back: Build runs again with your note.",
    );
  });
  it("names the lane the fail route leads to, and says when it asks first", () => {
    const fix = lane("fix", { uses: "core/agent@1", checkpoint: "out" });
    expect(consequenceWords(flow(failing("fix"), fix), after)).toMatch(/^Reject: Fix starts\./);
    const asks = lane("fix", { uses: "core/agent@1", checkpoint: "in" });
    expect(consequenceWords(flow(failing("fix"), asks), after)).toMatch(/^Reject: Fix waits for you\./);
  });
  it("says a dropped run is dropped", () => {
    expect(consequenceWords(flow(failing("@drop")), before)).toBe("Reject: the run is dropped.");
  });
  it("offers no send back before a lane has run", () => {
    expect(consequenceWords(flow(failing("@stop")), before)).toBe("Reject: the run stops.");
  });
  it("does not guess when a condition decides or the workflow is not known", () => {
    const conditional = [{ to: "fix", when: { ref: "change.tier", in: ["low"] } }, { to: "@stop" }];
    expect(consequenceWords(flow(failing(conditional)), after)).toBe(
      "Reject: the lane's fail route decides. Send back: Build runs again with your note.",
    );
    expect(consequenceWords(undefined, after)).toBe(
      "Reject: the lane's fail route decides. Send back: the lane runs again with your note.",
    );
  });
  it("says nothing for a question", () => {
    expect(consequenceWords(flow(failing("@stop")), { lane: "build", kind: "question", decisions: ["answer"] })).toBeUndefined();
  });
});
