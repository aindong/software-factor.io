import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { drawable, type Floor, layout } from "../../src/core/floor/layout.ts";
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

  it("runs no two lines along the same stretch of track, unless they lead to the same station", () => {
    const flat = segments(floor).filter(({ a, b }) => a[1] === b[1]);
    for (const [i, s] of flat.entries()) {
      for (const t of flat.slice(i + 1)) {
        if (s.line === t.line || s.a[1] !== t.a[1]) continue;
        // lines of one outcome to one station run together, like branches of one line
        if (s.line.to === t.line.to && s.line.outcome === t.line.outcome) continue;
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

describe("a workflow that does not pass the checker yet", () => {
  it("is still drawn, with a target that no lane has as a station that is missing", () => {
    const doc = {
      lanes: [
        { id: "a", on: { pass: "nowhere", fail: [{ to: "a", maxRounds: 1 }, { to: "@stop" }] } },
        { id: "b" },
        7,
        { on: {} },
      ],
    };
    const workflow = drawable(doc);
    expect(workflow?.lanes.map((l) => l.id)).toEqual(["a", "b"]);
    const floor = layout(workflow as Workflow);
    expect(floor.stations.find((s) => s.id === "nowhere")).toMatchObject({ kind: "end", missing: true });
    expect(floor.lines.length).toBe(3);
  });

  it("is not drawn when it has no lane", () => {
    for (const doc of [null, 5, {}, { lanes: "x" }, { lanes: [] }, { lanes: [{}] }])
      expect(drawable(doc)).toBeUndefined();
  });
});

// Shapes the shipped workflows do not hold: built here, and held to the same rules.
const on = (pass: unknown, fail: unknown = "@stop", extra: Record<string, unknown> = {}) => ({
  pass,
  fail,
  ...extra,
});
const lanesOf = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `l${i}`,
    on: on(
      i === count - 1 ? "@done" : `l${i + 1}`,
      i > 0 ? [{ to: "l0", maxRounds: 1 }, { to: "@stop" }] : "@stop",
    ),
  }));
const shapes: [string, unknown][] = [
  ["one lane", { lanes: [{ id: "a", on: on("@done") }] }],
  [
    "a lane that leads to itself, first on the line",
    {
      lanes: [
        { id: "a", on: on("b", [{ to: "a", maxRounds: 1 }, { to: "@stop" }]) },
        { id: "b", on: on("@done") },
      ],
    },
  ],
  [
    "a lane with five ways out, one of them to itself",
    {
      lanes: [
        {
          id: "a",
          on: on("b", [
            { to: "a", maxRounds: 1 },
            { to: "b", when: { ref: "task.source", in: ["x"] } },
            { to: "c", when: { ref: "task.source", in: ["y"] } },
            { to: "@stop" },
          ]),
        },
        { id: "b", on: on("c") },
        { id: "c", on: on("@done") },
      ],
    },
  ],
  ["twenty lanes that all loop back to the first", { lanes: lanesOf(20) }],
  [
    "a lane that asks a person and is sent to another lane",
    {
      lanes: [
        { id: "a", on: on("b", "@stop", { needsPerson: "c" }) },
        { id: "b", on: on("c") },
        { id: "c", on: on("@done", "@stop", { needsPerson: "@inbox" }) },
      ],
    },
  ],
  [
    "a pass with three conditions",
    {
      lanes: [
        {
          id: "a",
          on: on([
            { to: "c", when: { ref: "task.source", in: ["x"] } },
            { to: "d", when: { ref: "task.source", in: ["y"] } },
            { to: "@drop", when: { ref: "task.source", in: ["z"] } },
            { to: "b" },
          ]),
        },
        { id: "b", on: on("c") },
        { id: "c", on: on("d") },
        { id: "d", on: on("@done") },
      ],
    },
  ],
  [
    "a pass that goes back",
    {
      lanes: [
        { id: "a", on: on("b") },
        { id: "b", on: on([{ to: "a", maxRounds: 2 }, { to: "@done" }]) },
      ],
    },
  ],
];

describe.each(shapes)("the map of %s", (_name, doc) => {
  const floor = layout(drawable(doc) as Workflow);
  const at = new Map(floor.stations.map((s) => [s.id, s]));
  const all = segments(floor);

  it("keeps every line at 0, 45 or 90 degrees, and no stretch of no length", () => {
    for (const { a, b } of all) {
      const [dx, dy] = [Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])];
      expect(dx === 0 || dy === 0 || dx === dy).toBe(true);
      expect(dx + dy).toBeGreaterThan(0);
    }
  });

  it("starts and ends every line inside its own stations", () => {
    for (const line of floor.lines) {
      const [first, last] = [line.points[0], line.points.at(-1)];
      expect(
        Math.abs((first?.[0] ?? 0) - (at.get(line.from)?.x ?? 0)),
        `${line.key} leaves`,
      ).toBeLessThanOrEqual(24);
      expect(
        Math.abs((last?.[0] ?? 0) - (at.get(line.to)?.x ?? 0)),
        `${line.key} arrives`,
      ).toBeLessThanOrEqual(24);
    }
  });

  it("runs no two lines along the same stretch, across or up and down, unless they lead to the same station", () => {
    for (const axis of [0, 1] as const) {
      const other = axis === 0 ? 1 : 0;
      const along = all.filter(({ a, b }) => a[other] === b[other] && a[axis] !== b[axis]);
      for (const [i, s] of along.entries()) {
        for (const t of along.slice(i + 1)) {
          if (s.line === t.line || s.a[other] !== t.a[other]) continue;
          if (s.line.to === t.line.to && s.line.outcome === t.line.outcome) continue;
          const shared =
            Math.min(Math.max(s.a[axis], s.b[axis]), Math.max(t.a[axis], t.b[axis])) -
            Math.max(Math.min(s.a[axis], s.b[axis]), Math.min(t.a[axis], t.b[axis]));
          expect(shared, `${s.line.key} and ${t.line.key}`).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it("passes no line through a station that is not its own", () => {
    for (const { line, a, b } of all) {
      for (const s of floor.stations) {
        if (s.id === line.from || s.id === line.to) continue;
        // the distance from the station to the segment
        const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
        const t = Math.max(0, Math.min(1, ((s.x - a[0]) * dx + (s.y - a[1]) * dy) / (dx * dx + dy * dy)));
        const near = Math.hypot(s.x - (a[0] + t * dx), s.y - (a[1] + t * dy));
        expect(near, `${line.key} near ${s.id}`).toBeGreaterThanOrEqual(17);
      }
    }
  });
});
