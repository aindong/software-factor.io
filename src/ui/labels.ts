// Where each station's name and role line go on the map so that no text meets another text or a
// route, and nothing is cut off at the map's edge. Plain data in and out: the widths are measured
// by the drawing, for the face and the names are the owner's.
import type { Floor } from "../core/floor/layout.ts";

/** How far a label that does not fit its first place steps out, up or down. */
export const TIER = 38;
const FIRST = { above: -36, below: 34, beside: -30 } as const;
const HIGH = 14; // the text reaches this far above its baseline
const LOW = 6; // and this far below it, 20 when a line follows
const ROOM = 6; // between texts

/** A station's text as measured: the x range of its name and role line, from the station. */
export interface Ink {
  left: number;
  right: number;
  /** A role line sits under the name. */
  two: boolean;
}
/** A text on a route, as measured: its box on the map. */
export interface Tag {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Placed {
  /** The baseline of each name, from its station. */
  y: Record<string, number>;
  /** A name that stands beside its station when it can, and is centred over it once it is raised. */
  centred: Record<string, boolean>;
  /** How far the map must reach past the lines and stations to hold the text, on each side. */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

type Box = [number, number, number, number]; // left, top, right, bottom
const meets = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

export function placeNames(floor: Floor, inks: Record<string, Ink>, tags: Tag[]): Placed {
  const ys = floor.lines.flatMap((l) => l.points.map((p) => p[1]));
  const [railTop, railBottom] = [Math.min(floor.mainY, ...ys), Math.max(floor.mainY, ...ys)];
  // every route as points, close enough together that a text between two is found
  const dots = floor.lines.flatMap((l) =>
    l.points.slice(1).flatMap((b, i) => {
      const a = l.points[i] ?? b;
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
      return Array.from({ length: n + 1 }, (_, k): [number, number] => [
        a[0] + ((b[0] - a[0]) * k) / n,
        a[1] + ((b[1] - a[1]) * k) / n,
      ]);
    }),
  );
  const taken: Box[] = tags.map((t) => [t.x - 2, t.y - 2, t.x + t.width + 2, t.y + t.height + 2]);
  const placed: Placed = { y: {}, centred: {}, top: 0, bottom: 0, left: 0, right: 0 };
  let [x0, x1, y0, y1] = [0, floor.width, 0, floor.height];
  for (const s of [...floor.stations].sort((a, b) => a.x - b.x)) {
    const drawn = inks[s.id];
    if (!drawn) continue;
    // beside, a name ends 18 px left of its station; raised, it is centred over it so that a reader sees whose it is
    const wide = (drawn.right - drawn.left) / 2;
    const beside = s.labelSide === "beside";
    const sat: Ink = beside ? { ...drawn, left: -18 - 2 * wide, right: -18 } : drawn;
    const over: Ink = { ...drawn, left: -wide, right: wide };
    let ink = sat;
    const base = FIRST[s.labelSide];
    const up = s.labelSide !== "below";
    const box = (y: number): Box => [
      s.x + ink.left - ROOM,
      s.y + y - HIGH,
      s.x + ink.right + ROOM,
      s.y + y + (ink.two ? 20 : LOW),
    ];
    const free = (b: Box) =>
      !taken.some((t) => meets(b, t)) && !dots.some(([x, y]) => x > b[0] && x < b[2] && y > b[1] && y < b[3]);
    let y: number = base;
    for (let tier = 1; tier <= 12 && !free(box(y)); tier += 1) {
      if (beside) {
        ink = over;
        placed.centred[s.id] = true;
      }
      y = up
        ? Math.min(base - tier * TIER, railTop - s.y - 44 - (tier - 1) * TIER)
        : Math.max(base + tier * TIER, railBottom - s.y + 28 + (tier - 1) * TIER);
    }
    const b = box(y);
    taken.push(b);
    placed.y[s.id] = y;
    x0 = Math.min(x0, b[0] + ROOM - 4);
    x1 = Math.max(x1, b[2] - ROOM + 4);
    y0 = Math.min(y0, b[1] - 2);
    y1 = Math.max(y1, b[3] + 2);
  }
  return { ...placed, left: -x0, right: x1 - floor.width, top: -y0, bottom: y1 - floor.height };
}
