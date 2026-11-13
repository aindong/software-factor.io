// What approving an inbox item sets going, said so that it is true: a lane that asks again before it
// runs "waits for you", it does not "start".
import { describe, expect, it } from "vitest";
import type { Workflow } from "../../src/core/schema/workflow.ts";
import { nextStop } from "../../src/ui/next-lane.ts";

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
const before = { lane: "ship", kind: "approval", decisions: ["approve", "reject"] };
const agent = { uses: "core/agent@1" };
const build = (pass: unknown) => lane("build", { ...agent, checkpoint: "in", on: { pass, fail: "@stop" } });

describe("what approving starts", () => {
  it("names the lane that starts when the next lane does not ask", () => {
    for (const checkpoint of ["near", "out"]) {
      expect(nextStop(flow(build("ship"), lane("ship", { checkpoint })), after)).toBe("Ship starts");
    }
    // an agent lane that asks asks for its work afterwards: it starts, and it is then looked at
    expect(nextStop(flow(build("test"), lane("test", { ...agent, checkpoint: "in" })), after)).toBe(
      "Test starts",
    );
  });
  it("says the next lane waits for you when it asks before it runs", () => {
    const asks = [{ checkpoint: "in" }, { ...agent, checkpoint: "in", oneWay: true }];
    for (const more of asks) {
      expect(nextStop(flow(build("ship"), lane("ship", more)), after)).toBe("Ship waits for you");
    }
  });
  it("says the lane starts for an approval that comes before it", () => {
    expect(nextStop(flow(build("ship"), lane("ship", { checkpoint: "in" })), before)).toBe("Ship starts");
  });
  it("says the run ends done", () => {
    expect(nextStop(flow(build("@done")), after)).toBe("the run ends done");
  });
  it("says nothing when it cannot be known", () => {
    const w = flow(build([{ when: "x", to: "ship" }]), lane("ship"));
    expect(nextStop(w, after)).toBeUndefined();
    expect(nextStop(flow(build("@stop")), after)).toBeUndefined();
    expect(nextStop(flow(build("nowhere")), after)).toBeUndefined();
    expect(nextStop(undefined, after)).toBeUndefined();
    expect(nextStop(w, { ...after, kind: "question" })).toBeUndefined();
  });
});
