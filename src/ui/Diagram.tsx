// The workflow drawn as a line diagram, from the layout: stations, lines at 0, 45 and 90 degrees,
// gates as bars before a station's exit. A station is a button: the arrow keys move along the
// map, Enter opens a station, `c` connects it. Dragging from a station's handle draws a line.
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import type { Floor, Line, Outcome, Point, Station } from "../core/floor/layout.ts";

const BEND = 12;
const WORD: Record<Outcome, string> = { pass: "pass", fail: "fail", needsPerson: "asks" };
const END_CLASS: Record<string, string> = {
  "@done": "done",
  "@stop": "stop",
  "@drop": "drop",
  "@inbox": "inbox",
};
const END_MARK: Record<string, string> = {
  "@done": "M-4.500 0l3 3 6-6",
  "@stop": "M-4 0h8",
  "@drop": "M-3.500-3.500l7 7M3.500-3.500l-7 7",
  "@inbox": "M0-4.500v5M0 4v.01",
};

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

function LineView({ line }: { line: Line }) {
  const d = pathOf(line.points);
  const toEnd = line.to === "@stop" || line.to === "@drop";
  const track = line.points.length > 2 ? { start: line.points[2], end: line.points[3] } : undefined;
  const leftward = track?.start && track.end ? track.end[0] < track.start[0] : false;
  const words = [WORD[line.outcome], line.maxRounds ? `×${line.maxRounds}` : "", line.conditional ? "if" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <g>
      {line.outcome === "needsPerson" && !toEnd ? <path className="casing" d={d} /> : null}
      <path
        className={`line ${line.outcome}${toEnd ? " to-end" : ""}${line.conditional ? " conditional" : ""}`}
        d={d}
      />
      {line.conditional ? null : <path className="head" d={headOf(line.points)} />}
      {track?.start ? (
        <text
          className="tag"
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

const subOf = (s: Station) =>
  s.kind === "end"
    ? ""
    : s.uses === "core/agent@1"
      ? `${s.role ?? "no role"}${s.panel ? ", panel" : ""}`
      : s.uses === "core/command@1"
        ? "command"
        : s.uses === "core/wait@1"
          ? "wait"
          : (s.uses ?? "");

export interface DiagramProps {
  floor: Floor;
  selected?: string;
  /** Lanes the checker has something to say about. */
  flagged: Set<string>;
  onSelect: (id: string | undefined) => void;
  onOpen: (id: string) => void;
  onAskConnect: (id: string) => void;
  onConnect: (from: string, outcome: "pass" | "fail", to: string) => void;
}

export function Diagram({
  floor,
  selected,
  flagged,
  onSelect,
  onOpen,
  onAskConnect,
  onConnect,
}: DiagramProps) {
  const svg = useRef<SVGSVGElement>(null);
  const nodes = useRef(new Map<string, SVGGElement>());
  const byKeys = useRef(false);
  const [drag, setDrag] = useState<{ from: string; outcome: "pass" | "fail"; x: number; y: number }>();
  const order = [...floor.stations].sort((a, b) => a.x - b.x);
  const tabStop = selected && order.some((s) => s.id === selected) ? selected : order[0]?.id;

  // after a move by the arrow keys, the keyboard's focus follows the selection
  useEffect(() => {
    if (byKeys.current && selected) nodes.current.get(selected)?.focus();
    byKeys.current = false;
  }, [selected]);

  const onKey = (event: KeyboardEvent, station: Station) => {
    const at = order.findIndex((s) => s.id === station.id);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step !== 0) {
      const next = order[at + step];
      if (next) {
        byKeys.current = true;
        onSelect(next.id);
      }
    } else if (event.key === "Enter" || event.key === " ") onOpen(station.id);
    else if (event.key === "c" && station.kind === "lane") onAskConnect(station.id);
    else if (event.key === "Escape") onSelect(undefined);
    else return;
    event.preventDefault();
  };

  const pointOf = (event: PointerEvent) => {
    const box = svg.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  };
  const drop = (event: PointerEvent) => {
    if (!drag) return;
    const { x, y } = pointOf(event);
    const target = floor.stations.find((s) => Math.hypot(s.x - x, s.y - y) <= 26);
    if (target && !target.missing) onConnect(drag.from, drag.outcome, target.id);
    setDrag(undefined);
  };
  const from = drag ? floor.stations.find((s) => s.id === drag.from) : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the map takes pointer moves only while a line is being dragged; every action is also on a station, which is a button
    // biome-ignore lint/a11y/useKeyWithClickEvents: a click on empty map clears the selection; by keyboard that is Escape on a station
    // biome-ignore lint/a11y/useSemanticElements: an SVG cannot be a fieldset
    <svg
      ref={svg}
      className="map"
      width={floor.width}
      height={floor.height}
      role="group"
      aria-label="The workflow as a line diagram. Arrow keys move between stations, Enter opens one, c connects it."
      onPointerMove={(event) => drag && setDrag({ ...drag, ...pointOf(event) })}
      onPointerUp={drop}
      onPointerLeave={() => setDrag(undefined)}
      onClick={(event) => event.target === svg.current && onSelect(undefined)}
    >
      {floor.lines.map((line) => (
        <LineView key={line.key} line={line} />
      ))}
      {floor.stations.flatMap((s) =>
        s.gates.map((gate, k) => (
          <rect
            key={`${s.id}.${gate}`}
            className="gate"
            x={s.x + 30 + k * 7}
            y={s.y - 9}
            width="3"
            height="18"
            rx="1.500"
          >
            <title>{`Gate ${gate}: runs on the host before the lane can pass`}</title>
          </rect>
        )),
      )}
      {drag && from ? (
        <path className={`line ${drag.outcome} drawing`} d={`M${from.x} ${from.y}L${drag.x} ${drag.y}`} />
      ) : null}
      {order.map((s) => {
        const capsule = s.checkpoint === "in";
        // beside: lines leave on both sides, so the label sits up and to the left, clear of them
        const beside = s.labelSide === "beside";
        const nameY = s.labelSide === "below" ? 34 : beside ? -30 : -36;
        const nameX = beside ? -18 : 0;
        const anchor = beside ? "end" : "middle";
        const sub = subOf(s);
        const about =
          s.kind === "end"
            ? `${s.label}, an end of the run`
            : `Lane ${s.label}${sub ? `, ${sub}` : ""}${capsule ? ", waits for a person" : ""}${flagged.has(s.id) ? ", has problems" : ""}`;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a station is drawn in SVG, where there is no button element
          <g
            key={s.id}
            ref={(node) => {
              if (node) nodes.current.set(s.id, node);
              else nodes.current.delete(s.id);
            }}
            className={`station ${s.kind}${s.kind === "end" ? ` ${END_CLASS[s.id] ?? ""}` : ""}${s.missing ? " missing" : ""}${flagged.has(s.id) ? " bad" : ""}`}
            transform={`translate(${s.x} ${s.y})`}
            role="button"
            tabIndex={s.id === tabStop ? 0 : -1}
            aria-pressed={s.id === selected}
            aria-label={about}
            onClick={() => onSelect(s.id)}
            onDoubleClick={() => onOpen(s.id)}
            onKeyDown={(event) => onKey(event, s)}
          >
            {capsule ? (
              <rect className="ring" x="-26" y="-17" width="52" height="34" rx="17" />
            ) : (
              <circle className="ring" r="17" />
            )}
            {capsule ? (
              <rect className="body" x="-20" y="-11" width="40" height="22" rx="11" />
            ) : (
              <circle className="body" r="11" />
            )}
            {s.kind === "end" && !s.missing ? <path className="mark" d={END_MARK[s.id] ?? ""} /> : null}
            {flagged.has(s.id) ? (
              <rect className="flag" x="9" y="-21" width="8" height="8" transform="rotate(45 13 -17)" />
            ) : null}
            <text className="name" x={nameX} y={nameY} textAnchor={anchor}>
              {s.label}
            </text>
            {sub ? (
              <text className="sub" x={nameX} y={nameY + 14} textAnchor={anchor}>
                {sub}
              </text>
            ) : null}
            {s.kind === "lane"
              ? (["pass", "fail"] as const).map((outcome) => (
                  <circle
                    key={outcome}
                    className={`handle ${outcome}`}
                    r="5"
                    cx={outcome === "pass" ? (capsule ? 26 : 19) : 0}
                    cy={outcome === "pass" ? 0 : 19}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      setDrag({ from: s.id, outcome, ...pointOf(event) });
                    }}
                  >
                    <title>{`Drag to a station to set where this lane goes when it ${outcome === "pass" ? "passes" : "fails"}`}</title>
                  </circle>
                ))
              : null}
          </g>
        );
      })}
    </svg>
  );
}
