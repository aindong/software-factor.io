// The lines of the line diagram: a route drawn through its points with rounded corners, a notch near its
// end, and the word on it (pass, fail, asks).
import type { Line, Outcome, Point } from "../core/floor/layout.ts";

const BEND = 12;
const WORD: Record<Outcome, string> = { pass: "pass", fail: "fail", needsPerson: "asks" };

/** A line through the points, with each corner rounded. */
function pathOf(points: Point[]): string {
  const [first, ...rest] = points;
  if (!first) return "";
  let d = `M${first[0]} ${first[1]}`;
  for (const [i, corner] of rest.entries()) {
    const before = points[i] ?? corner;
    const after = rest[i + 1];
    if (!after) {
      d += `L${corner[0]} ${corner[1]}`;
      break;
    }
    const [inLen, outLen] = [
      Math.hypot(corner[0] - before[0], corner[1] - before[1]),
      Math.hypot(after[0] - corner[0], after[1] - corner[1]),
    ];
    const cut = Math.min(BEND, inLen / 2, outLen / 2);
    const a = [
      corner[0] - ((corner[0] - before[0]) / inLen) * cut,
      corner[1] - ((corner[1] - before[1]) / inLen) * cut,
    ];
    const b = [
      corner[0] + ((after[0] - corner[0]) / outLen) * cut,
      corner[1] + ((after[1] - corner[1]) / outLen) * cut,
    ];
    d += `L${a[0]} ${a[1]}Q${corner[0]} ${corner[1]} ${b[0]} ${b[1]}`;
  }
  return d;
}

/** A small notch on the line near its end, pointing the way it runs. */
function headOf(points: Point[]): string {
  const [end, before] = [points.at(-1), points.at(-2)];
  if (!end || !before) return "";
  const len = Math.hypot(end[0] - before[0], end[1] - before[1]) || 1;
  const [ux, uy] = [(end[0] - before[0]) / len, (end[1] - before[1]) / len];
  const [cx, cy] = [end[0] - ux * 24, end[1] - uy * 24];
  return `M${cx + ux * 3} ${cy + uy * 3}L${cx - ux * 2 - uy * 2.5} ${cy - uy * 2 + ux * 2.5}L${cx - ux * 2 + uy * 2.5} ${cy - uy * 2 - ux * 2.5}Z`;
}

export function LineView({ line, lit, flows }: { line: Line; lit: boolean; flows: boolean }) {
  const d = pathOf(line.points);
  const toEnd = line.to === "@stop" || line.to === "@drop";
  const track = line.points.length > 2 ? { start: line.points[2], end: line.points[3] } : undefined;
  const leftward = track?.start && track.end ? track.end[0] < track.start[0] : false;
  const words = [WORD[line.outcome], line.maxRounds ? `×${line.maxRounds}` : "", line.conditional ? "if" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <g>
      {line.outcome === "needsPerson" && !toEnd ? (
        <path className={`casing${lit ? " lit" : ""}`} d={d} />
      ) : null}
      <path
        className={`line ${line.outcome}${toEnd ? " to-end" : ""}${line.conditional ? " conditional" : ""}${lit ? " lit" : ""}`}
        d={d}
      />
      {flows ? <path className="flow" d={d} /> : null}
      {line.conditional ? null : <path className="head" d={headOf(line.points)} />}
      {track?.start ? (
        <text
          className={`tag${lit ? " lit" : ""}`}
          x={track.start[0] + (leftward ? -6 : 6)}
          y={track.start[1] - 7}
          textAnchor={leftward ? "end" : "start"}
        >
          {words}
        </text>
      ) : null}
    </g>
  );
}
