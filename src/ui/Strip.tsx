// A run as a strip map: the one-line diagram above a carriage door. Each lane is a stop, drawn
// by what the run did there, and the train is on the lane the run is at. A state is a shape as
// well as a colour.
import type { StopState, Track } from "../core/runs/track.ts";

const GAP = 18;
const PAD = 10;
const MID = 9;
export const STATE_WORD: Record<StopState, string> = {
  none: "not reached",
  pass: "passed",
  fail: "failed",
  asked: "asked a person",
  here: "at work",
};

/** The shape of one stop, around the origin. */
export function Stop({ state }: { state: StopState }) {
  if (state === "fail")
    return <rect className="stop fail" x="-4" y="-4" width="8" height="8" transform="rotate(45)" />;
  if (state === "asked") return <rect className="stop asked" x="-4" y="-4" width="8" height="8" />;
  return <circle className={`stop ${state}`} r={state === "pass" ? 4.5 : 3.5} />;
}

export function Strip({ track, nameOf }: { track: Track; nameOf: (id: string) => string }) {
  const width = PAD * 2 + Math.max(0, track.lanes.length - 1) * GAP;
  const at = track.lanes.findIndex((l) => l.id === track.here);
  const said = track.lanes
    .map((l) => `${nameOf(l.id)} ${STATE_WORD[l.state]}${l.id === track.here ? ", the run is here" : ""}`)
    .join("; ");
  return (
    <svg className="strip" role="img" aria-label={said || "No lane yet"} width={width} height={MID * 2}>
      <title>{said}</title>
      <path className="way" d={`M${PAD} ${MID}H${width - PAD}`} />
      {at >= 0 ? (
        <rect className="train" x={PAD + at * GAP - 8} y={MID - 7} width="16" height="14" rx="7" />
      ) : null}
      {track.lanes.map((lane, i) => (
        <g key={lane.id} transform={`translate(${PAD + i * GAP} ${MID})`}>
          <Stop state={lane.state} />
        </g>
      ))}
    </svg>
  );
}
