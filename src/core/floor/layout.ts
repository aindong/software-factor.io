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
  /** Where the label goes so that it does not sit on a line, when one side is free. */
  labelSide: "above" | "below";
  uses?: string;
  role?: string;
  checkpoint?: string;
  gates: string[];
  panel: boolean;
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

export const GAP = 168; // between stations
const PAD = 96; // left and right of the first and last station, for labels
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
  const ids = [...order, ...ENDS.filter((e) => used.has(e))];
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
        .flatMap((d) => [
          ...(d.fromAt === index ? [{ d, end: "from" as const, other: d.toAt }] : []),
          ...(d.toAt === index ? [{ d, end: "to" as const, other: d.fromAt }] : []),
        ])
        .sort((a, b) => a.other - b.other || (a.end === "to" ? -1 : 1));
      const step = Math.min(PORT, 48 / Math.max(1, here.length - 1));
      for (const [k, port] of here.entries()) {
        const slot = ports.get(port.d);
        if (slot) slot[port.end] = Math.round((k - (here.length - 1) / 2) * step);
      }
    }
  }
  const ends = (d: Draft) => {
    const port = ports.get(d) ?? { from: 0, to: 0 };
    // a lane's line to itself leaves on one side of the station and comes back on the other
    const self = d.fromAt === d.toAt ? 2 * BEVEL : 0;
    return { a: xOf(d.fromAt) + port.from + self, b: xOf(d.toAt) + port.to - self };
  };

  // A track for each line that is not on the main line: the shortest lines nearest to it, and no
  // two lines on one track where they would run along each other.
  const level = new Map<Draft, number>();
  const depth = { [-1]: 0, [1]: 0 };
  for (const side of [-1, 1] as const) {
    const taken: [number, number][][] = [];
    const lines = drafts
      .filter((d) => d.side === side)
      .sort((p, q) => span(p) - span(q) || p.fromAt - q.fromAt);
    for (const d of lines) {
      const { a, b } = ends(d);
      const [lo, hi] = [Math.min(a, b) - BEVEL, Math.max(a, b) + BEVEL];
      let at = taken.findIndex((row) => row.every(([l, h]) => hi < l || lo > h));
      if (at < 0) at = taken.push([]) - 1;
      taken[at]?.push([lo, hi]);
      level.set(d, at + 1);
    }
    depth[side] = taken.length;
  }
  function span(d: Draft): number {
    return Math.abs(d.toAt - d.fromAt);
  }

  const mainY = EDGE + (depth[-1] > 0 ? CLEAR + depth[-1] * TRACK : 0);
  const height = mainY + (depth[1] > 0 ? CLEAR + depth[1] * TRACK : 0) + EDGE;
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
    const points: Point[] = [
      [a, mainY],
      [a, y - side * BEVEL],
      [a + dir * BEVEL, y],
      [b - dir * BEVEL, y],
      [b, y - side * BEVEL],
      [b, mainY],
    ];
    return { ...line, points };
  });

  const busy = (index: number, side: -1 | 1) =>
    drafts.some((d) => d.side === side && (d.fromAt === index || d.toAt === index));
  const stations: Station[] = ids.map((id, index) => {
    const lane = workflow.lanes[index];
    const labelSide = !busy(index, -1) ? "above" : !busy(index, 1) ? "below" : "above";
    const at = { id, x: xOf(index), y: mainY, labelSide } as const;
    if (!lane) return { ...at, kind: "end", label: END_LABEL[id] ?? id, gates: [], panel: false };
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
