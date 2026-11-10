// The factory floor as a line diagram: where each station sits and how each line runs. A workflow
// file holds no positions, so the map is laid out from the process itself: the lanes in their
// order along one main line, each other transition on a track of its own above or below it.
// Lines run only at 0, 45 and 90 degrees. This is plain data: the interface draws it.
import { stepsOf } from "../schema/transitions.ts";
import type { Workflow } from "../schema/workflow.ts";

export type Outcome = "pass" | "fail" | "needsPerson";
export type Point = [number, number];

export interface Station {
  /** A lane's id, or an end: "@done", "@inbox", "@stop", "@drop". */
  id: string;
  kind: "lane" | "end";
  x: number;
  y: number;
  label: string;
  /** Where the label goes so that it does not sit on a line: above or below when that side is free, else beside. */
  labelSide: "above" | "below" | "beside";
  uses?: string;
  role?: string;
  checkpoint?: string;
  gates: string[];
  panel: boolean;
  /** A transition names it, but no lane has this id. */
  missing?: boolean;
}

export interface Line {
  /** Its place in the workflow, such as "review.fail[0]". */
  key: string;
  from: string;
  to: string;
  outcome: Outcome;
  points: Point[];
  /** It leads to an earlier lane, or to the lane it leaves. */
  back: boolean;
  /** It is taken only when a condition holds. */
  conditional: boolean;
  maxRounds?: number;
}

export interface Floor {
  stations: Station[];
  lines: Line[];
  width: number;
  height: number;
  /** The height of the main line. */
  mainY: number;
}

export const GAP = 124; // between stations
const PAD = 72; // left and right of the first and last station, for labels
const TRACK = 28; // between tracks
const CLEAR = 36; // from the main line to the first track
const BEVEL = 12; // the 45-degree stretch at each corner
const EDGE = 56; // above the highest and below the lowest thing drawn
const PORT = 8; // between two lines that leave or reach one station on the same side
const ENDS = ["@done", "@inbox", "@stop", "@drop"];
const END_LABEL: Record<string, string> = {
  "@done": "Done",
  "@inbox": "Inbox",
  "@stop": "Stopped",
  "@drop": "Dropped",
};

interface Draft extends Omit<Line, "points"> {
  side: -1 | 0 | 1; // above, on the main line, below
  fromAt: number;
  toAt: number;
}

export function layout(workflow: Workflow): Floor {
  const order = workflow.lanes.map((l) => l.id);
  const drafts: Draft[] = [];
  const used = new Set<string>();
  for (const [i, lane] of workflow.lanes.entries()) {
    for (const outcome of ["pass", "fail", "needsPerson"] as const) {
      const transition = lane.on[outcome];
      if (transition === undefined) continue;
      for (const [j, step] of stepsOf(transition).entries()) {
        if (step.to.startsWith("@")) used.add(step.to);
        const target = order.indexOf(step.to);
        drafts.push({
          key: typeof transition === "string" ? `${lane.id}.${outcome}` : `${lane.id}.${outcome}[${j}]`,
          from: lane.id,
          to: step.to,
          outcome,
          back: target >= 0 && target <= i,
          conditional: step.when !== undefined,
          maxRounds: step.maxRounds,
          side: outcome === "fail" ? 1 : -1,
          fromAt: i,
          toAt: target,
        });
      }
    }
  }
  // a target that is no lane and no end is still drawn, as a station that is missing, so it can be fixed
  const unknown = [...new Set(drafts.filter((d) => d.toAt < 0 && !ENDS.includes(d.to)).map((d) => d.to))];
  const ids = [...order, ...ENDS.filter((e) => used.has(e)), ...unknown];
  for (const d of drafts) if (d.toAt < 0) d.toAt = ids.indexOf(d.to);
  // the pass route to the next station is the main line itself: one line for each pair of neighbours
  const onMain = new Set<number>();
  for (const d of drafts) {
    if (d.outcome !== "pass" || d.toAt !== d.fromAt + 1 || onMain.has(d.fromAt)) continue;
    onMain.add(d.fromAt);
    d.side = 0;
  }
  const xOf = (index: number) => PAD + index * GAP;

  // Where a line leaves or reaches a station, a few pixels apart from the others on that side,
  // in the order of where they lead, so that they cross as little as possible.
  const ports = new Map<Draft, { from: number; to: number }>();
  for (const d of drafts) ports.set(d, { from: 0, to: 0 });
  for (const side of [-1, 1] as const) {
    for (const index of ids.keys()) {
      const here = drafts
        .filter((d) => d.side === side && (d.fromAt === index || d.toAt === index))
        .flatMap((d): { d: Draft; end?: "from" | "to"; other: number; key: string }[] => {
          // A lane's line to itself comes back beside where it left, with one free place between
          // so that it reads as a loop. A second such loop on the same side goes around the first.
          if (d.fromAt === d.toAt) {
            const out = d.outcome === "needsPerson" ? 0.4 : 0.2;
            return [
              { d, end: "to", other: index - out, key: `to ${d.key}` },
              { d, other: index, key: `gap ${d.key}` },
              { d, end: "from", other: index + out, key: `from ${d.key}` },
            ];
          }
          return [
            ...(d.fromAt === index ? [{ d, end: "from" as const, other: d.toAt, key: `from ${d.key}` }] : []),
            // lines of one outcome that end here arrive together, at one point
            ...(d.toAt === index ? [{ d, end: "to" as const, other: -1, key: `to ${d.outcome}` }] : []),
          ];
        })
        .sort((a, b) => a.other - b.other);
      const slots = [...new Set(here.map((p) => p.key))];
      const step = Math.min(PORT, 48 / Math.max(1, slots.length - 1));
      for (const port of here) {
        const slot = ports.get(port.d);
        if (slot && port.end)
          slot[port.end] = Math.round((slots.indexOf(port.key) - (slots.length - 1) / 2) * step);
      }
    }
  }
  const ends = (d: Draft) => {
    const port = ports.get(d) ?? { from: 0, to: 0 };
    return { a: xOf(d.fromAt) + port.from, b: xOf(d.toAt) + port.to };
  };

  // A track for each group of lines that is not on the main line. Lines of one outcome that lead
  // to the same station run together on one track, like the branches of one line joining: every
  // lane that fails to "Stopped" is then one grey line with a spur from each lane. The shortest
  // groups are nearest to the main line, and no two groups share a track where they would overlap.
  const level = new Map<Draft, number>();
  const depth = { above: 0, below: 0 };
  for (const side of [-1, 1] as const) {
    const groups = new Map<string, Draft[]>();
    for (const d of drafts.filter((x) => x.side === side)) {
      const key = `${d.to} ${d.outcome}`;
      groups.set(key, [...(groups.get(key) ?? []), d]);
    }
    const reach = (group: Draft[]): [number, number] => {
      const xs = group.flatMap((d) => [ends(d).a, ends(d).b]);
      return [Math.min(...xs) - BEVEL, Math.max(...xs) + BEVEL];
    };
    const taken: [number, number][][] = [];
    const ordered = [...groups.values()].sort(
      (p, q) => reach(p)[1] - reach(p)[0] - (reach(q)[1] - reach(q)[0]),
    );
    for (const group of ordered) {
      const [lo, hi] = reach(group);
      let at = taken.findIndex((row) => row.every(([l, h]) => hi < l || lo > h));
      if (at < 0) at = taken.push([]) - 1;
      taken[at]?.push([lo, hi]);
      for (const d of group) level.set(d, at + 1);
    }
    depth[side === -1 ? "above" : "below"] = taken.length;
  }
  const mainY = EDGE + (depth.above > 0 ? CLEAR + depth.above * TRACK : 0);
  const height = mainY + (depth.below > 0 ? CLEAR + depth.below * TRACK : 0) + EDGE;
  const lines: Line[] = drafts.map((d) => {
    const { side, fromAt, toAt, ...line } = d;
    if (side === 0)
      return {
        ...line,
        points: [
          [xOf(fromAt), mainY],
          [xOf(toAt), mainY],
        ],
      };
    const { a, b } = ends(d);
    const y = mainY + side * (CLEAR + (level.get(d) ?? 1) * TRACK);
    const dir = b > a ? 1 : -1;
    const bevel = Math.min(BEVEL, Math.floor(Math.abs(b - a) / 2) - 1); // a tighter turn for a loop to itself
    const points: Point[] = [
      [a, mainY],
      [a, y - side * bevel],
      [a + dir * bevel, y],
      [b - dir * bevel, y],
      [b, y - side * bevel],
      [b, mainY],
    ];
    return { ...line, points };
  });

  const busy = (index: number, side: -1 | 1) =>
    drafts.some((d) => d.side === side && (d.fromAt === index || d.toAt === index));
  const stations: Station[] = ids.map((id, index) => {
    const lane = workflow.lanes[index];
    const labelSide = !busy(index, -1) ? "above" : !busy(index, 1) ? "below" : "beside";
    const at = { id, x: xOf(index), y: mainY, labelSide } as const;
    if (!lane) {
      const missing = unknown.includes(id) ? { missing: true } : {};
      return { ...at, kind: "end", label: END_LABEL[id] ?? id, gates: [], panel: false, ...missing };
    }
    return {
      ...at,
      kind: "lane",
      label: lane.name ?? lane.id,
      uses: lane.uses,
      role: lane.agent?.role,
      checkpoint: lane.checkpoint,
      gates: lane.gates ?? [],
      panel: lane.panel !== undefined,
    };
  });
  return { stations, lines, width: PAD * 2 + Math.max(0, ids.length - 1) * GAP, height, mainY };
}

/**
 * A workflow as far as it can be drawn, from JSON that may not pass the checker yet: its lanes
 * that have an id, each with whatever transitions it has. Nothing when there is no lane to draw.
 */
export function drawable(doc: unknown): Workflow | undefined {
  type Loose = Record<string, unknown>;
  const object = (v: unknown): Loose | undefined =>
    typeof v === "object" && v !== null ? (v as Loose) : undefined;
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  const lanes = object(doc)?.lanes;
  if (!Array.isArray(lanes)) return undefined;
  const kept = lanes.flatMap((given) => {
    const lane = object(given);
    if (!lane || typeof lane.id !== "string" || lane.id === "") return [];
    const on: Record<string, unknown> = {};
    for (const [outcome, t] of Object.entries(object(lane.on) ?? {})) {
      if (typeof t === "string") on[outcome] = t;
      else if (Array.isArray(t)) {
        const steps = t.filter((s) => typeof object(s)?.to === "string");
        if (steps.length > 0) on[outcome] = steps;
      }
    }
    const agent = object(lane.agent);
    return [
      {
        id: lane.id,
        name: text(lane.name),
        uses: text(lane.uses) ?? "",
        checkpoint: text(lane.checkpoint),
        gates: Array.isArray(lane.gates) ? lane.gates.filter((g) => typeof g === "string") : undefined,
        agent: agent ? { role: text(agent.role) } : undefined,
        panel: lane.panel,
        on,
      },
    ];
  });
  return kept.length > 0 ? ({ lanes: kept } as unknown as Workflow) : undefined;
}
