import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Floor, layout } from "../../src/core/floor/layout.ts";
import { parseWorkflow } from "../../src/core/schema/parse.ts";
import { stepsOf } from "../../src/core/schema/transitions.ts";
import type { Workflow } from "../../src/core/schema/workflow.ts";

const files = [
  ...readdirSync("workflows").map((f) => join("workflows", f)),
  ...readdirSync("test/fixtures/workflows/hard-cases").map((f) =>
    join("test/fixtures/workflows/hard-cases", f),
  ),
].filter((f) => f.endsWith(".json"));
const load = (file: string): Workflow => {
  const { workflow, problems } = parseWorkflow(JSON.parse(readFileSync(file, "utf8")));
  if (!workflow) throw new Error(`${file}: ${problems[0]?.message}`);
  return workflow;
};
const segments = (floor: Floor) =>
  floor.lines.flatMap((line) => line.points.slice(1).map((p, i) => ({ line, a: line.points[i] ?? p, b: p })));

describe.each(files)("the map of %s", (file) => {
  const workflow = load(file);
  const floor = layout(workflow);

  it("has one station for each lane and for each end a transition names", () => {
    const ends = new Set(
      workflow.lanes.flatMap((l) =>
        Object.values(l.on).flatMap((t) => (t ? stepsOf(t).map((s) => s.to) : [])),
      ),
    );
    const wanted = [...workflow.lanes.map((l) => l.id), ...[...ends].filter((e) => e.startsWith("@"))].sort();
    expect(floor.stations.map((s) => s.id).sort()).toEqual(wanted);
  });

  it("has one line for each step of each transition, with its outcome", () => {
    const wanted = workflow.lanes.flatMap((l) =>
      Object.entries(l.on).flatMap(([outcome, t]) =>
        t ? stepsOf(t).map((s) => `${l.id} ${outcome} ${s.to}`) : [],
      ),
    );
    expect(floor.lines.map((l) => `${l.from} ${l.outcome} ${l.to}`).sort()).toEqual(wanted.sort());
  });

  it("runs every line at 0, 45 or 90 degrees only", () => {
    for (const { line, a, b } of segments(floor)) {
      const [dx, dy] = [Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])];
      expect(dx === 0 || dy === 0 || dx === dy, `${line.from} to ${line.to}: ${a} to ${b}`).toBe(true);
      expect(dx + dy).toBeGreaterThan(0);
    }
  });

  it("puts no two stations in one place, and keeps them apart", () => {
    for (const [i, a] of floor.stations.entries()) {
      for (const b of floor.stations.slice(i + 1)) {
        expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.id} and ${b.id}`).toBeGreaterThanOrEqual(100);
      }
    }
  });

  it("starts and ends every line at its stations", () => {
    const at = new Map(floor.stations.map((s) => [s.id, s]));
    for (const line of floor.lines) {
      const [first, last] = [line.points[0], line.points.at(-1)];
      const [from, to] = [at.get(line.from), at.get(line.to)];
      expect(Math.abs((first?.[0] ?? 0) - (from?.x ?? 0))).toBeLessThanOrEqual(30);
      expect(first?.[1]).toBe(from?.y);
      expect(Math.abs((last?.[0] ?? 0) - (to?.x ?? 0))).toBeLessThanOrEqual(30);
      expect(last?.[1]).toBe(to?.y);
    }
  });

  it("runs no two lines along the same stretch of track", () => {
    const flat = segments(floor).filter(({ a, b }) => a[1] === b[1]);
    for (const [i, s] of flat.entries()) {
      for (const t of flat.slice(i + 1)) {
        if (s.line === t.line || s.a[1] !== t.a[1]) continue;
        const [s1, s2] = [Math.min(s.a[0], s.b[0]), Math.max(s.a[0], s.b[0])];
        const [t1, t2] = [Math.min(t.a[0], t.b[0]), Math.max(t.a[0], t.b[0])];
        const shared = Math.min(s2, t2) - Math.max(s1, t1);
        expect(
          shared,
          `${s.line.from}>${s.line.to} and ${t.line.from}>${t.line.to} at y=${s.a[1]}`,
        ).toBeLessThanOrEqual(0);
      }
    }
  });

  it("fits inside its own size, with room for labels", () => {
    for (const s of floor.stations) {
      expect(s.x).toBeGreaterThanOrEqual(60);
      expect(s.x).toBeLessThanOrEqual(floor.width - 60);
    }
    for (const { a, b } of segments(floor)) {
      for (const [x, y] of [a, b]) {
        expect(x >= 0 && x <= floor.width && y >= 0 && y <= floor.height).toBe(true);
      }
    }
  });
});

describe("the map's notation", () => {
  const floor = layout(load("workflows/alleo-loop.json"));
  const line = (from: string, outcome: string) =>
    floor.lines.filter((l) => l.from === from && l.outcome === outcome);

  it("draws the first lane leftmost and the lanes in their order", () => {
    const lanes = floor.stations.filter((s) => s.kind === "lane");
    expect(lanes.map((s) => s.x)).toEqual([...lanes.map((s) => s.x)].sort((a, b) => a - b));
  });

  it("marks a line that goes back, with its round limit", () => {
    const back = line("review", "fail").find((l) => l.to === "build");
    expect(back).toMatchObject({ back: true, maxRounds: 2 });
  });

  it("marks a line that depends on a condition", () => {
    expect(line("review", "pass").find((l) => l.to === "verify-ui")?.conditional).toBe(true);
    expect(line("review", "pass").find((l) => l.to === "ship")?.conditional).toBe(false);
  });

  it("gives a lane that waits for a person a different station from one that does not", () => {
    const workflow = load("workflows/alleo-loop.json");
    for (const lane of workflow.lanes) {
      const station = floor.stations.find((s) => s.id === lane.id);
      expect(station?.checkpoint).toBe(lane.checkpoint);
      expect(station?.gates).toEqual(lane.gates ?? []);
    }
  });
});
