import { describe, expect, it } from "vitest";
import type { Floor, Station } from "../../src/core/floor/layout.ts";
import { badgeLift, CAPSULE } from "../../src/ui/badges.ts";

const station = (labelSide: Station["labelSide"]): Station => ({
  id: "build",
  kind: "lane",
  x: 100,
  y: 100,
  label: "Build",
  labelSide,
  gates: [],
  panel: false,
});
const floor = (s: Station) => ({ stations: [s] }) as unknown as Floor;
const margin = 6;

// where the badge ends up, as a box, for a station at (100, 100) whose first place is 30 from it
const boxOf = (side: Station["labelSide"], at: { out: number; across: number } | undefined) => {
  const dir = side === "below" ? -1 : 1;
  const [x, y] = [100 + (at?.across ?? 0), 100 + dir * (30 + (at?.out ?? 0))];
  return { l: x - CAPSULE.w / 2, r: x + CAPSULE.w / 2, t: y - CAPSULE.h / 2, b: y + CAPSULE.h / 2 };
};
const gap = (a: ReturnType<typeof boxOf>, t: { x: number; y: number; width: number; height: number }) =>
  Math.max(t.x - a.r, a.l - (t.x + t.width), t.y - a.b, a.t - (t.y + t.height));

describe("where a task badge stands at its station", () => {
  it("stays at its first place when no label of a line is near", () => {
    expect(badgeLift(floor(station("above")), [], 30, margin)).toEqual({ build: { out: 0, across: 0 } });
  });

  it.each([
    ["above", { x: 112, y: 128, width: 30, height: 12 }], // a label over the first place
    ["above", { x: 60, y: 132, width: 30, height: 12 }], // a label just left of it, 5 units from its edge
    ["below", { x: 112, y: 62, width: 30, height: 12 }],
    ["below", { x: 72, y: 60, width: 30, height: 12 }],
  ] as const)("moves the least that clears a label by 6 units: a name %s, %j", (side, tag) => {
    const at = badgeLift(floor(station(side)), [tag], 30, margin).build;
    expect(at && at.out + Math.abs(at.across) > 0).toBe(true);
    expect(gap(boxOf(side, at), tag)).toBeGreaterThanOrEqual(margin);
  });
});

describe("a stack of task badges at one station", () => {
  it("keeps every badge of the stack clear of a label, not only the first", () => {
    // a label where the third badge of a stack of three would stand (first at 30, then 30 apart)
    const tag = { x: 85, y: 150, width: 30, height: 12 };
    const alone = badgeLift(floor(station("above")), [tag], 30, margin, 30, {}).build;
    const stacked = badgeLift(floor(station("above")), [tag], 30, margin, 30, { build: 3 }).build;
    expect(alone).toEqual({ out: 0, across: 0 });
    expect(stacked && stacked.out + Math.abs(stacked.across) > 0).toBe(true);
    for (const k of [0, 1, 2]) {
      const box = boxOf("above", { out: (stacked?.out ?? 0) + k * 30, across: stacked?.across ?? 0 });
      expect(gap(box, tag)).toBeGreaterThanOrEqual(margin);
    }
  });
});
