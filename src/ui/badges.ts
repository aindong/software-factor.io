// Where a task's badge stands at its station: on the side its name is not on, and moved the least that
// puts it a margin clear of every label of a line (fail, asks). Plain data in and out, like labels.ts.
import type { Floor } from "../core/floor/layout.ts";
import type { Tag } from "./labels.ts";

/** The painted badge: a capsule 34 by 18 map units, centred where the badge stands. */
export const CAPSULE = { w: 34, h: 18 };
const LIMIT = 40; // the farthest it moves
const STEP = 2;

/** How far a badge moves from its first place: `out` away from its station, `across` sideways. */
export interface Lift {
  out: number;
  across: number;
}

export function badgeLift(floor: Floor, tags: Tag[], off: number, margin: number): Record<string, Lift> {
  const lift: Record<string, Lift> = {};
  for (const s of floor.stations) {
    // a name below puts the badge over the station, and the other way round
    const dir = s.labelSide === "below" ? -1 : 1;
    const clear = ({ out, across }: Lift) => {
      const [x, y] = [s.x + across, s.y + dir * (off + out)];
      const [l, r, t, b] = [
        x - CAPSULE.w / 2 - margin,
        x + CAPSULE.w / 2 + margin,
        y - CAPSULE.h / 2 - margin,
        y + CAPSULE.h / 2 + margin,
      ];
      return !tags.some((g) => g.x < r && l < g.x + g.width && g.y < b && t < g.y + g.height);
    };
    lift[s.id] = { out: 0, across: 0 };
    for (let d = 0; d <= LIMIT; d += STEP) {
      const found = (
        [
          { out: d, across: 0 },
          { out: 0, across: d },
          { out: 0, across: -d },
        ] as Lift[]
      ).find(clear);
      if (found) {
        lift[s.id] = found;
        break;
      }
    }
  }
  return lift;
}
