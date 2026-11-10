// From the skeptic's second look at task 14: a lane's line to itself must have places of its own
// among the other lines that leave its station, however many there are.
import { expect, it } from "vitest";
import { drawable, layout } from "../../src/core/floor/layout.ts";
import type { Workflow } from "../../src/core/schema/workflow.ts";

const when = { ref: "task.source", in: ["x"] };
/** The two nearest up-and-down stretches of lines that do not run together, and how far apart they are. */
const nearest = (doc: unknown) => {
  const floor = layout(drawable(doc) as Workflow);
  const ups = floor.lines.flatMap((line) =>
    line.points.slice(1).flatMap((b, i) => {
      const a = line.points[i] ?? b;
      return a[0] === b[0] ? [{ line, x: a[0], lo: Math.min(a[1], b[1]), hi: Math.max(a[1], b[1]) }] : [];
    }),
  );
  let least = { gap: Number.POSITIVE_INFINITY, pair: "" };
  for (const [i, s] of ups.entries()) {
    for (const t of ups.slice(i + 1)) {
      if (s.line === t.line || (s.line.to === t.line.to && s.line.outcome === t.line.outcome)) continue;
      if (Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) <= 0) continue;
      const gap = Math.abs(s.x - t.x);
      if (gap < least.gap) least = { gap, pair: `${s.line.key} and ${t.line.key}` };
    }
  }
  return least;
};
const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
const loop = (others: string[]) => [
  { to: "a", maxRounds: 1 },
  ...others.map((to) => ({ to, when })),
  { to: "@stop" },
];
/** `n` lanes in a row, where the first fails to itself, to every other lane and to a stop. */
const shape = (n: number) => ({
  lanes: ids.slice(0, n).map((id, i) => ({
    id,
    on: { pass: i + 1 < n ? ids[i + 1] : "@done", fail: i === 0 ? loop(ids.slice(1, n)) : "@stop" },
  })),
});

it("a loop to itself shares no track with eight other ways out", () => {
  const { gap, pair } = nearest(shape(8));
  expect(gap, pair).toBeGreaterThan(0);
});

it("a loop to itself is a line's width from its neighbours (five ways out)", () => {
  const { gap, pair } = nearest(shape(3));
  expect(gap, `${pair} are ${gap}px apart`).toBeGreaterThanOrEqual(6);
});

it("a loop to itself comes back to its own station as a loop, not a knot", () => {
  for (const n of [1, 3, 8]) {
    const floor = layout(drawable(shape(n)) as Workflow);
    const self = floor.lines.find((l) => l.from === "a" && l.to === "a");
    const xs = (self?.points ?? []).map((p) => p[0]);
    // it leaves on one side and never doubles back on its way to the other
    expect(xs, `${n} lanes`).toEqual([...xs].sort((p, q) => q - p));
    expect((xs[0] ?? 0) - (xs.at(-1) ?? 0), `${n} lanes`).toBeGreaterThanOrEqual(8);
  }
});
