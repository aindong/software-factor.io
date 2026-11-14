// Where a task's badge stands at its station: on the side its name is not on, and moved the least that
// puts it a margin clear of every label of a line (fail, asks). Plain data in and out, like labels.ts.
import type { Floor } from "../core/floor/layout.ts";
import type { Tag } from "./labels.ts";

/** The painted badge: a capsule 34 by 18 map units, centred where the badge stands. */
export const CAPSULE = { w: 34, h: 18 };
const LIMIT = 80; // the farthest it moves
const STEP = 2;

/** How far a badge moves from its first place: `out` away from its station, `across` sideways. */
export interface Lift {
  out: number;
  across: number;
}

/** `counts` is how many badges stand stacked at a station, `step` the gap between them: every one of the stack keeps clear. */
export function badgeLift(
  floor: Floor,
  tags: Tag[],
  off: number | Record<string, number>,
  margin: number,
  step = 0,
  counts: Record<string, number> = {},
): Record<string, Lift> {
  const lift: Record<string, Lift> = {};
  for (const s of floor.stations) {
    // a name below puts the badge over the station, and the other way round
    const dir = s.labelSide === "below" ? -1 : 1;
    const clear = ({ out, across }: Lift) =>
      Array.from({ length: Math.max(1, counts[s.id] ?? 1) }, (_, k) => k).every((k) => {
        const [x, y] = [
          s.x + across,
          s.y + dir * ((typeof off === "number" ? off : (off[s.id] ?? 30)) + out + k * step),
        ];
        const [l, r, t, b] = [
          x - CAPSULE.w / 2 - margin,
          x + CAPSULE.w / 2 + margin,
          y - CAPSULE.h / 2 - margin,
          y + CAPSULE.h / 2 + margin,
        ];
        return !tags.some((g) => g.x < r && l < g.x + g.width && g.y < b && t < g.y + g.height);
      });
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

/** The stem that joins a stack of `n` badges to its station: down from the station's edge at its own x, to the stack's
 * side when the stack stands off to one side, along the stack, and a tick to each badge. `up` is -1 or 1. */
export function stemOf(up: number, out: number, step: number, n: number, across: number): string {
  const side = across > 0 ? Math.max(0, across - CAPSULE.w / 2 - 4) : Math.min(0, across + CAPSULE.w / 2 + 4);
  const ys = Array.from({ length: n }, (_, k) => up * (out + k * step));
  const ticks = ys
    .map((y) => `M${side} ${y}H${across + (across > 0 ? -1 : 1) * (CAPSULE.w / 2) || 0}`)
    .join("");
  return `M0 ${up * 17}V${ys[0]}H${side}V${ys[n - 1]}${ticks}`;
}
