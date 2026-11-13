// A lane that a person stopped is not a lane that failed: the run's view says which visit it was.
import { describe, expect, it } from "vitest";
import { stoppedVisit } from "../../src/core/runs/stopped.ts";
import { trackOf } from "../../src/core/runs/track.ts";

const visit = (id: number, outcome: "pass" | "fail" | null, note: string | null = null) => ({
  id,
  outcome,
  note,
});

describe("the visit a person stopped", () => {
  const person = "stopped_by_person";
  it("is the last one, when the run was stopped by a person and it ended in the stop's own words", () => {
    const visits = [visit(1, "pass"), visit(2, "fail", "stopped by a person")];
    expect(stoppedVisit(person, visits)).toBe(2);
    expect(stoppedVisit(person, [visit(1, "fail", "stopped by a person, after its process had died")])).toBe(
      1,
    );
  });
  it("is none for a lane that failed on its own, in a run that was stopped by a person later", () => {
    expect(stoppedVisit(person, [visit(1, "fail", "gate verify failed")])).toBeUndefined();
  });
  it("is none for any other way a run stops", () => {
    expect(stoppedVisit("lane_failed", [visit(1, "fail", "stopped by a person")])).toBeUndefined();
    expect(stoppedVisit(null, [visit(1, "fail", "stopped by a person")])).toBeUndefined();
  });
});

describe("the track of a run a person stopped", () => {
  it("shows the lane stopped, not failed", () => {
    const visits = [
      { lane: "plan", outcome: "pass" as const },
      { lane: "build", outcome: "fail" as const, stopped: true as const },
    ];
    const track = trackOf(["plan", "build"], visits, undefined, "build");
    expect(track.lanes.map((l) => l.state)).toEqual(["pass", "stopped"]);
  });
});
