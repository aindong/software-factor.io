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

describe("where a task badge stands under or over its station", () => {
  it("stays at its first place when no label of a line is near", () => {
    expect(badgeLift(floor(station("above")), [], 30, margin)).toEqual({ build: 0 });
  });

  it("steps out, away from the station, until it is 6 units clear of a label of a line", () => {
    // the badge of a station whose name is above stands below: its first place is y 130, 121 to 139
    const tag = { x: 112, y: 128, width: 30, height: 12 };
    const lift = badgeLift(floor(station("above")), [tag], 30, margin)["build"] ?? -1;
    expect(lift).toBeGreaterThan(0);
    const [top, bottom] = [100 + 30 + lift - CAPSULE.h / 2, 100 + 30 + lift + CAPSULE.h / 2];
    expect(top - margin >= tag.y + tag.height || bottom + margin <= tag.y).toBe(true);
  });

  it("steps up for a station whose name is below, its badge standing over it", () => {
    const tag = { x: 112, y: 62, width: 30, height: 12 };
    const lift = badgeLift(floor(station("below")), [tag], 30, margin)["build"] ?? -1;
    expect(lift).toBeGreaterThan(0);
    const [top, bottom] = [100 - 30 - lift - CAPSULE.h / 2, 100 - 30 - lift + CAPSULE.h / 2];
    expect(top - margin >= tag.y + tag.height || bottom + margin <= tag.y).toBe(true);
  });
});
