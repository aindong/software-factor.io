// Where a run has been, as the strip map, the big map and the scrubber all draw it.
import { describe, expect, it } from "vitest";
import { trackOf, type Visit } from "../../src/core/runs/track.ts";

const order = ["plan", "build", "review", "merge"];
const v = (lane: string, outcome: Visit["outcome"] = "pass"): Visit => ({ lane, outcome });
const states = (track: ReturnType<typeof trackOf>) => track.lanes.map((l) => `${l.id}:${l.state}`).join(" ");

describe("the track of a run", () => {
  it("shows nothing reached before the first step", () => {
    const track = trackOf(order, [v("plan"), v("build")], 0);
    expect(states(track)).toBe("plan:none build:none review:none merge:none");
    expect(track.here).toBeUndefined();
  });

  it("shows each lane's outcome and where the run is", () => {
    const visits = [v("plan"), v("build"), v("review", "fail"), v("build"), v("review", null)];
    expect(states(trackOf(order, visits, undefined, "review"))).toBe(
      "plan:pass build:pass review:here merge:none",
    );
    expect(trackOf(order, visits, undefined, "review").here).toBe("review");
    expect(states(trackOf(order, [v("plan", "needsPerson")]))).toBe(
      "plan:asked build:none review:none merge:none",
    );
  });

  it("steps: at step n only the first n visits count, and a lane shows its latest of those", () => {
    const visits = [v("plan"), v("build"), v("review", "fail"), v("build", "fail"), v("review")];
    const at = (n: number) => states(trackOf(order, visits, n));
    expect(at(1)).toBe("plan:pass build:none review:none merge:none");
    expect(at(2)).toBe("plan:pass build:pass review:none merge:none");
    expect(at(3)).toBe("plan:pass build:pass review:fail merge:none");
    expect(at(4)).toBe("plan:pass build:fail review:fail merge:none");
    expect(at(5)).toBe("plan:pass build:fail review:pass merge:none");
    // the train is on the lane of visit n; at the last step it is where the record says the run is
    expect([1, 2, 3, 4].map((n) => trackOf(order, visits, n, "merge").here)).toEqual([
      "plan",
      "build",
      "review",
      "build",
    ]);
    expect(trackOf(order, visits, 5, "merge").here).toBe("merge");
    expect(states(trackOf(order, visits, 5, "merge"))).toBe("plan:pass build:fail review:pass merge:here");
  });

  it("clamps a step outside the run", () => {
    const visits = [v("plan"), v("build")];
    expect(states(trackOf(order, visits, 99))).toBe(states(trackOf(order, visits)));
    expect(states(trackOf(order, visits, -3))).toBe(states(trackOf(order, visits, 0)));
    expect(states(trackOf(order, visits, 1.7))).toBe(states(trackOf(order, visits, 1)));
    expect(states(trackOf(order, visits, Number.NaN))).toBe(states(trackOf(order, visits)));
  });

  it("puts the run on the lane it waits before, when it has not entered it", () => {
    const track = trackOf(order, [v("plan"), v("build"), v("review")], undefined, "merge");
    expect(states(track)).toBe("plan:pass build:pass review:pass merge:here");
    expect(track.here).toBe("merge");
    // while stepping back, the run is where it was then, not where it is now
    expect(trackOf(order, [v("plan"), v("build"), v("review")], 2, "merge").here).toBe("build");
  });

  it("keeps a lane that already has an outcome as it is when the run stands on it", () => {
    const track = trackOf(order, [v("plan"), v("build", "fail")], undefined, "build");
    expect(states(track)).toBe("plan:pass build:fail review:none merge:none");
    expect(track.here).toBe("build");
  });

  it("adds a visit to a lane the workflow no longer has at the end, marked as gone", () => {
    const track = trackOf(order, [v("plan"), v("lint", "fail"), v("build")]);
    expect(states(track)).toBe("plan:pass build:pass review:none merge:none lint:fail");
    expect(track.lanes.at(-1)).toMatchObject({ id: "lint", gone: true });
    expect(track.lanes.filter((l) => l.gone).length).toBe(1);
    // also a lane the run only stands before
    expect(trackOf(order, [], undefined, "ship").lanes.at(-1)).toMatchObject({
      id: "ship",
      state: "here",
      gone: true,
    });
  });

  it("has no train on a run that is done", () => {
    const visits = order.map((lane) => v(lane));
    for (const at of [undefined, null]) {
      const track = trackOf(order, visits, undefined, at);
      expect(track.here).toBeUndefined();
      expect(states(track)).toBe("plan:pass build:pass review:pass merge:pass");
    }
    // but stepping back through it, the train is where the run was
    expect(trackOf(order, visits, 2, null).here).toBe("build");
  });

  it("adds a lane that is gone once, however often it was visited", () => {
    const track = trackOf(order, [v("lint", "fail"), v("plan"), v("lint")]);
    expect(states(track)).toBe("plan:pass build:none review:none merge:none lint:pass");
  });

  it("holds with nothing at all", () => {
    expect(trackOf([], [])).toEqual({ lanes: [], here: undefined });
    expect(states(trackOf(order, []))).toBe("plan:none build:none review:none merge:none");
  });

  it("does not change what it was given", () => {
    const visits = [v("plan")];
    const given = JSON.stringify([order, visits]);
    trackOf(order, visits, 1, "build");
    expect(JSON.stringify([order, visits])).toBe(given);
  });
});
