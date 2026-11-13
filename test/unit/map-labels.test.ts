import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layout } from "../../src/core/floor/layout.ts";
import { parseWorkflow } from "../../src/core/schema/parse.ts";
import { type Ink, placeNames, type Tag } from "../../src/ui/labels.ts";

const load = (file: string) => {
  const { workflow } = parseWorkflow(JSON.parse(readFileSync(file, "utf8")));
  if (!workflow) throw new Error(`${file} does not parse`);
  return workflow;
};

describe.each(["workflows/full-loop.json"])("the names on the map of %s", (file) => {
  const floor = layout(load(file));
  // widths as a face of about seven pixels a letter would give; a name is right-aligned when it sits beside
  const inks: Record<string, Ink> = {};
  for (const s of floor.stations) {
    const [w, sub] = [s.label.length * 7, s.kind === "end" ? 0 : 15 * 6];
    const [left, right] =
      s.labelSide === "beside"
        ? [-18 - Math.max(w, sub), -18]
        : [-Math.max(w, sub) / 2, Math.max(w, sub) / 2];
    inks[s.id] = { left, right, two: s.kind !== "end" };
  }
  const tags: Tag[] = floor.lines.flatMap((l) => {
    const at = l.points[2];
    return at ? [{ x: at[0] + 6, y: at[1] - 19, width: 36, height: 12 }] : [];
  });
  const placed = placeNames(floor, inks, tags);
  const boxes = floor.stations.map((s) => {
    const [ink, y] = [inks[s.id], placed.y[s.id]];
    if (!ink || y === undefined) throw new Error(`no place for ${s.id}`);
    return {
      id: s.id,
      l: s.x + ink.left,
      r: s.x + ink.right,
      t: s.y + y - 14,
      b: s.y + y + (ink.two ? 20 : 6),
    };
  });

  it("keeps every name clear of every other name and of every tag", () => {
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1))
        expect(a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b, `${a.id} ${b.id}`).toBe(false);
      for (const t of tags)
        expect(
          a.l < t.x + t.width && t.x < a.r && a.t < t.y + t.height && t.y < a.b,
          `${a.id} and a tag`,
        ).toBe(false);
    }
  });

  it("keeps every name clear of every route", () => {
    for (const a of boxes)
      for (const line of floor.lines)
        for (const [i, q] of line.points.slice(1).entries()) {
          const p = line.points[i] ?? q;
          for (let k = 0; k <= 20; k += 1) {
            const [x, y] = [p[0] + ((q[0] - p[0]) * k) / 20, p[1] + ((q[1] - p[1]) * k) / 20];
            expect(x > a.l && x < a.r && y > a.t && y < a.b, `${line.key} crosses ${a.id}`).toBe(false);
          }
        }
  });

  it("makes room at the edges for what reaches past the map", () => {
    expect(placed.left).toBeGreaterThanOrEqual(Math.max(0, -Math.min(...boxes.map((b) => b.l))));
    expect(placed.top).toBeGreaterThanOrEqual(Math.max(0, -Math.min(...boxes.map((b) => b.t))));
  });
});
