// A run on the Floor's map: a capsule with the task's number, beside the station it is at, with a
// transparent hit area behind it so that it can be pressed: 24 px square at desk width, 44 at phone width.
import type { Visit } from "../core/runs/track.ts";

export interface Train {
  lane: string;
  /** What the train carries: the task's number. */
  label: string;
  title: string;
  /** The run waits for a person here. */
  asks?: boolean;
  /** Work is going on in the lane now: an agent or a gate is working. */
  working?: boolean;
  /** The lanes its run has been in, to find the line it came along. */
  visits?: Visit[];
  /** Where the train leads: its run, or the inbox when it waits for a person. */
  href?: string;
}
/** A run on the map: a capsule with the task's number, beside the station it is at. */
export function TrainMark({ train, y, hit }: { train: Train; y: number; hit: { w: number; h: number } }) {
  return (
    <g
      className={`train${train.asks ? " asks" : ""}${train.working ? " working" : ""}`}
      transform={`translate(0 ${y})`}
    >
      <title>{train.title}</title>
      <rect className="hit" x={-hit.w / 2} y={-hit.h / 2} width={hit.w} height={hit.h} />
      <rect x="-17" y="-9" width="34" height="18" rx="9" />
      <text y="4" textAnchor="middle">
        {train.label}
      </text>
    </g>
  );
}
