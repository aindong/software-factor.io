// The workflow drawn as a line diagram, from the layout: stations, lines at 0, 45 and 90 degrees,
// gates as bars before a station's exit. A station is a button: the arrow keys move along the
// map, Enter opens a station, `c` connects it. Dragging from a station's handle draws a line.
// Runs are drawn over it and never change it: what a run did at each station, the lines it
// took, and a train where each run is. Without `onConnect` the map is only read.
import { type KeyboardEvent, type PointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Floor, Line, Outcome, Point, Station } from "../core/floor/layout.ts";
import { type StopState, travelledOf, type Visit } from "../core/runs/track.ts";
import { type Ink, type Placed, placeNames } from "./labels.ts";

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

function LineView({ line, lit, flows }: { line: Line; lit: boolean; flows: boolean }) {
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
function TrainMark({ train, y }: { train: Train; y: number }) {
  return (
    <g
      className={`train${train.asks ? " asks" : ""}${train.working ? " working" : ""}`}
      transform={`translate(0 ${y})`}
    >
      <title>{train.title}</title>
      <rect x="-17" y="-9" width="34" height="18" rx="9" />
      <text y="4" textAnchor="middle">
        {train.label}
      </text>
    </g>
  );
}

export interface DiagramProps {
  floor: Floor;
  selected?: string;
  /** Lanes the checker has something to say about. */
  flagged?: Set<string>;
  onSelect: (id: string | undefined) => void;
  /** A click or a tap on a station, when it should do more than select: open it, where the inspector is a sheet. */
  onPick?: (id: string) => void;
  /** A press on a train. */
  onGo?: (href: string) => void;
  onOpen?: (id: string) => void;
  onAskConnect?: (id: string) => void;
  /** Left out, the map is read and not changed. */
  onConnect?: (from: string, outcome: "pass" | "fail", to: string) => void;
  /** One run drawn over the map: what it did at each station, and the keys of the lines it took. */
  states?: Record<string, StopState>;
  route?: Set<string>;
  /** Where runs are. */
  trains?: Train[];
}
const NONE = new Set<string>();
const RAN: Partial<Record<StopState, { word: string; mark: string }>> = {
  pass: { word: "passed in this run", mark: "M-4.500 0l3 3 6-6" },
  fail: { word: "failed in this run", mark: "M-3.500-3.500l7 7M3.500-3.500l-7 7" },
  asked: { word: "asked a person in this run", mark: "M0-4.500v5M0 4v.01" },
  here: { word: "at work in this run", mark: "" },
};

export function Diagram({
  floor,
  selected,
  flagged = NONE,
  onSelect,
  onPick,
  onGo,
  onOpen,
  onAskConnect,
  onConnect,
  states,
  route,
  trains = [],
}: DiagramProps) {
  const svg = useRef<SVGSVGElement>(null);
  const nodes = useRef(new Map<string, SVGGElement>());
  const byKeys = useRef(false);
  const [drag, setDrag] = useState<{ from: string; outcome: "pass" | "fail"; x: number; y: number }>();
  // the line a working run came along carries dashes in the way it goes
  const flowing = new Set(
    trains.filter((t) => t.working && t.visits).map((t) => travelledOf(floor.lines, t.visits ?? [])),
  );
  const order = [...floor.stations].sort((a, b) => a.x - b.x);
  // Names and role lines are placed clear of each other, of the routes and of the edge. The widths are
  // measured, for the face and the names are the owner's: nothing here knows how wide a name is until it is drawn.
  const [placed, setPlaced] = useState<Placed>();
  useLayoutEffect(() => {
    let live = true;
    const place = () => {
      const inks: Record<string, Ink> = {};
      for (const s of order) {
        const texts = [
          ...(nodes.current.get(s.id)?.querySelectorAll<SVGTextElement>("text.name, text.sub") ?? []),
        ];
        const boxes = texts.filter((t) => typeof t.getBBox === "function").map((t) => t.getBBox());
        if (boxes.length === 0) continue;
        inks[s.id] = {
          left: Math.min(...boxes.map((b) => b.x)),
          right: Math.max(...boxes.map((b) => b.x + b.width)),
          two: boxes.length > 1,
        };
      }
      const tags = [...(svg.current?.querySelectorAll<SVGTextElement>("text.tag") ?? [])]
        .filter((t) => typeof t.getBBox === "function")
        .map((t) => t.getBBox());
      const next = placeNames(floor, inks, tags);
      if (live) setPlaced((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
    };
    place();
    document.fonts?.ready.then(place); // the face may arrive after the first drawing
    return () => {
      live = false;
    };
  });
  const [top, bottom, left, right] = [
    Math.ceil(placed?.top ?? 0),
    Math.ceil(placed?.bottom ?? 0),
    Math.ceil(placed?.left ?? 0),
    Math.ceil(placed?.right ?? 0),
  ];
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
    } else if (event.key === "Enter" || event.key === " ") onOpen?.(station.id);
    else if (event.key === "c" && !event.metaKey && !event.ctrlKey && station.kind === "lane" && onAskConnect)
      onAskConnect(station.id);
    else if (event.key === "Escape") onSelect(undefined);
    else return;
    event.preventDefault();
  };

  const pointOf = (event: PointerEvent) => {
    const box = svg.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0) - left, y: event.clientY - (box?.top ?? 0) - top };
  };
  const drop = (event: PointerEvent) => {
    if (!drag) return;
    const { x, y } = pointOf(event);
    const target = floor.stations.find((s) => Math.hypot(s.x - x, s.y - y) <= 26);
    // a press on the handle with no drag ends on the lane's own station: that is not a connection
    if (target && !target.missing && target.id !== drag.from) onConnect?.(drag.from, drag.outcome, target.id);
    setDrag(undefined);
  };
  const from = drag ? floor.stations.find((s) => s.id === drag.from) : undefined;

  return (
    // the map takes pointer moves only while a line is being dragged: every action is also on a station, which is a button
    // biome-ignore lint/a11y/useKeyWithClickEvents: a click on empty map clears the selection; by keyboard that is Escape on a station
    // biome-ignore lint/a11y/useSemanticElements: an SVG cannot be a fieldset
    <svg
      ref={svg}
      className={`map${states ? " overlaid" : ""}`}
      width={floor.width + left + right}
      height={floor.height + top + bottom}
      viewBox={`${-left} ${-top} ${floor.width + left + right} ${floor.height + top + bottom}`}
      // a run's map is read whole: it is drawn smaller to fit its box, down to seven tenths, and scrolls after that
      style={
        states
          ? { maxWidth: "100%", minWidth: (floor.width + left + right) * 0.7, height: "auto" }
          : undefined
      }
      role="group"
      aria-label={
        onConnect
          ? "The workflow as a line diagram. Arrow keys move between stations, Enter opens one, c connects it."
          : "The run on the workflow's line diagram. Arrow keys move between stations."
      }
      onPointerMove={(event) => drag && setDrag({ ...drag, ...pointOf(event) })}
      onPointerUp={drop}
      onPointerLeave={() => setDrag(undefined)}
      onClick={(event) => event.target === svg.current && onSelect(undefined)}
    >
      {floor.lines.map((line) => (
        <LineView
          key={line.key}
          line={line}
          lit={route?.has(line.key) ?? false}
          flows={flowing.has(line.key)}
        />
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
        const nameY = placed?.y[s.id] ?? (s.labelSide === "below" ? 34 : beside ? -30 : -36);
        const nameX = beside ? -18 : 0;
        const anchor = beside ? "end" : "middle";
        const sub = subOf(s);
        const ran = RAN[states?.[s.id] ?? "none"];
        // with a run over the map, an end the run did not come to steps back like the lines to it
        const far =
          states && s.kind === "end" && !floor.lines.some((l) => l.to === s.id && route?.has(l.key));
        const here = trains.filter((t) => t.lane === s.id);
        // trains wait on the side of the station its name is not on
        const up = s.labelSide === "below" ? -1 : 1;
        const about =
          s.kind === "end"
            ? `${s.label}, an end of the run`
            : `Lane ${s.label}${sub ? `, ${sub}` : ""}${capsule ? ", waits for a person" : ""}${flagged.has(s.id) ? ", has problems" : ""}${ran ? `, ${ran.word}` : ""}${here.map((t) => `, task ${t.label} is here${t.working ? " and working" : ""}`).join("")}`;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a station is drawn in SVG, where there is no button element
          <g
            key={s.id}
            ref={(node) => {
              if (node) nodes.current.set(s.id, node);
              else nodes.current.delete(s.id);
            }}
            className={`station ${s.kind}${s.kind === "end" ? ` ${END_CLASS[s.id] ?? ""}` : ""}${s.missing ? " missing" : ""}${flagged.has(s.id) ? " bad" : ""}${ran ? ` ran-${states?.[s.id]}` : ""}${far ? " far" : ""}${here.some((t) => t.working) ? " working" : ""}`}
            transform={`translate(${s.x} ${s.y})`}
            role="button"
            tabIndex={s.id === tabStop ? 0 : -1}
            aria-pressed={s.id === selected}
            aria-label={about}
            onClick={() => (onPick ?? onSelect)(s.id)}
            onDoubleClick={() => onOpen?.(s.id)}
            onKeyDown={(event) => onKey(event, s)}
          >
            {here.some((t) => t.working) ? (
              capsule ? (
                <rect className="pulse" x="-31" y="-22" width="62" height="44" rx="22" />
              ) : (
                <circle className="pulse" r="22" />
              )
            ) : null}
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
            {ran?.mark ? <path className="mark" d={ran.mark} /> : null}
            {here.map((train, k) =>
              // a train is a way to its run: a link, so that it can be pressed and reached by Tab
              train.href && onGo ? (
                <a
                  key={train.label}
                  href={train.href}
                  aria-label={`Task ${train.label}: ${train.title}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onGo(train.href ?? "");
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <TrainMark train={train} y={up * (30 + k * 20)} />
                </a>
              ) : (
                <TrainMark key={train.label} train={train} y={up * (30 + k * 20)} />
              ),
            )}
            {flagged.has(s.id) ? (
              <rect className="flag" x="9" y="-21" width="8" height="8" transform="rotate(45 13 -17)" />
            ) : null}
            <text className="name" x={nameX} y={nameY} textAnchor={anchor}>
              {s.label}
            </text>
            {sub ? (
              <text className="sub" x={nameX} y={nameY + 16} textAnchor={anchor}>
                {sub}
              </text>
            ) : null}
            {s.kind === "lane" && onConnect
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
