// One run: its sentence, the run drawn on the workflow's map with a control that steps through
// it, what waits for a person, the diff, the files its agents attached, and each lane it went
// through with its gates, claims and sessions. Every piece of evidence opens in place.
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { drawable, layout } from "../core/floor/layout.ts";
import { groupEvidence, routeOf, stepOf, trackOf } from "../core/runs/track.ts";
import type { Workflow } from "../core/schema/workflow.ts";
import { getRun, type RunDetail, type RunRow } from "./api.ts";
import { useChanged } from "./changed.ts";
import { Diagram } from "./Diagram.tsx";
import { DiffView, FileView, PairView, Proof } from "./Evidence.tsx";
import { failingGate, gateWhat } from "./gates.ts";
import { LaneVisit, stateOf } from "./LaneVisit.tsx";
import { Lead, leadKeys } from "./Lead.tsx";
import { leadLane } from "./lead.ts";
import { RunHeader, Waits } from "./RunHeader.tsx";
import { reveal } from "./reveal.ts";
import { STATE_WORD } from "./Strip.tsx";
import { pageSays } from "./says.ts";

export interface RunViewProps {
  row: RunRow;
  workflow: Workflow | undefined;
  headRef: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
  /** What the way back is called, on a narrow screen. */
  back?: string;
  /** The screen around it already asks for the decision: do not name the command for it too. */
  deciding?: boolean;
  /** The inbox item this is shown for: the lane it is about comes first, with its proof open. */
  lead?: { kind: string; lane: string; decisions: string[] };
}

export function RunView({ row, workflow, headRef, onBack, back = "All runs", deciding, lead }: RunViewProps) {
  const [detail, setDetail] = useState<RunDetail>();
  const [problem, setProblem] = useState<string>();
  const [at, setAt] = useState<number>(); // the step shown: the latest, until the control is moved
  const [open, setOpen] = useState<Set<string>>(new Set()); // the proofs that are open: several, to compare
  const [station, setStation] = useState<string>();
  const proofs = useRef(new Map<string, HTMLDivElement>());
  const blocks = useRef(new Map<string, HTMLLIElement>()); // each lane's latest part under "Lane by lane"
  const scroller = useRef<HTMLDivElement>(null);
  // the row changes whenever the run does: its lanes, its sentence, its cost
  const stamp = JSON.stringify(row);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the stamp stands for the row
  useEffect(() => {
    let left = false;
    getRun(row.id).then(({ status, body }) => {
      if (left) return;
      setDetail(status === 200 ? body.run : undefined);
      setProblem(status === 200 ? undefined : (body.error ?? "This run could not be read."));
    });
    return () => {
      left = true;
    };
  }, [row.id, stamp]);

  // The map is the workflow the run ran on, kept with the run when it started. A run older than
  // that record is drawn on the workflow as it is today, and says so.
  const kept = detail?.kept;
  const drawn = useMemo(
    () => (row.own ? (kept ? drawable(kept) : undefined) : workflow),
    [row.own, kept, workflow],
  );
  const floor = useMemo(() => (drawn ? layout(drawn) : undefined), [drawn]);
  // On a narrow screen the map is wider than the window: show where the run is, or where it ended.
  // The run's page is not shown while the list is, so this is done again when the map gets a size.
  // biome-ignore lint/correctness/useExhaustiveDependencies: when the run moves or its map is drawn
  useEffect(() => {
    const view = scroller.current;
    if (!view) return;
    const end = { done: "done", stopped: "stop", dropped: "drop" }[row.status as string];
    const place = () => {
      const mark = view.querySelector(end ? `.station.end.${end}` : '.station[aria-label*=" is here"]');
      const box = view.getBoundingClientRect();
      if (!mark || box.width === 0) return;
      const at = mark.getBoundingClientRect();
      view.scrollLeft += at.left - box.left - (box.width - at.width) / 2;
    };
    place();
    const watch = new ResizeObserver(place);
    watch.observe(view);
    return () => watch.disconnect();
  }, [row.status, row.at, floor]);
  const first = detail && lead ? leadLane(detail.lanes, lead) : undefined;
  // the first lane's proof is open when it is first shown, and stays as the person leaves it
  const opened = useRef("");
  const arrival = detail && lead ? `${row.id}:${first?.id}` : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: once for each lane that comes first
  useEffect(() => {
    if (!detail || !first || opened.current === arrival) return;
    opened.current = arrival;
    setOpen((now) => new Set([...now, ...leadKeys(detail, first)]));
  }, [arrival]);
  const names = new Map(row.stops.map((l) => [l.id, l.name]));
  const nameOf = (id: string) => names.get(id) ?? id;
  const asking = !deciding && (detail?.inbox.length ?? 0) > 0;
  const total = row.visits.length;
  const step = stepOf(total, at);
  // the end the run came to: a run a person stopped after its last lane passed did not come to Done
  const end = { done: "@done", dropped: "@drop", stopped: "@stop", running: undefined, waiting: undefined }[
    row.status
  ];
  const track = trackOf(
    row.stops.map((l) => l.id),
    row.visits,
    step,
    row.at,
  );
  const states = Object.fromEntries(track.lanes.map((l) => [l.id, l.state]));
  const visit = row.visits[step - 1];
  const stepWords =
    step === 0
      ? "Before the first lane"
      : `Step ${step} of ${total}: ${nameOf(visit?.lane ?? "")} ${STATE_WORD[stateOf(visit?.outcome ?? null, visit?.stopped)]}`;
  const roundOf = (lane: RunDetail["lanes"][number] | undefined) => {
    const same = lane ? (detail?.lanes.filter((l) => l.lane === lane.lane) ?? []) : [];
    return lane && same.length > 1 ? same.indexOf(lane) + 1 : undefined;
  };
  // a lane's evidence that is opened shows the gate it failed on, open: that is why a person looks
  const toggle = (key: string) => {
    const next = new Set(open);
    if (!next.delete(key)) {
      next.add(key);
      const failed = detail?.lanes.find((l) => `lane:${l.id}` === key);
      const gate = failed && failingGate(failed);
      if (gate) next.add(gate.output);
    }
    setOpen(next);
  };
  // what a gate checks is the gate's own description in the workflow the run ran on
  const what = (gate: string) => gateWhat(detail?.kept ?? (row.own ? undefined : workflow), gate);
  // the gate the run stopped on: the latest lane that failed on one
  const stoppedOn = detail?.lanes.findLast((l) => !l.stopped && failingGate(l));
  const stopGate = stoppedOn && failingGate(stoppedOn);
  // a run that stopped on a gate opens on its failure: that lane's evidence, and the gate's output, open
  const failure =
    !lead && row.status === "stopped" && stoppedOn === detail?.lanes.at(-1) ? stoppedOn : undefined;
  const failed = failure ? `${row.id}:${failure.id}` : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: once for each lane that failed
  useEffect(() => {
    if (!failure || !stopGate || opened.current === failed) return;
    opened.current = failed;
    setOpen((now) => new Set([...now, `lane:${failure.id}`, stopGate.output]));
  }, [failed]);
  // the diff is read for the references of a lane whose evidence is open: they lead to it when it has what they name
  const changed = useChanged(
    row.id,
    stamp,
    !!detail?.lanes.some((l) => open.has(`lane:${l.id}`) && l.claims.length > 0),
  );
  const showDiff = () => {
    setOpen(new Set(open).add("diff"));
    reveal(() => proofs.current.get("diff"));
  };
  // what the page's first sentence says: a lane's card does not say it again
  const says = deciding || asking ? undefined : pageSays(row);
  const proof = (key: string) => ({
    open: open.has(key),
    onToggle: () => {
      // what is opened near the bottom of the page is brought into view, not left below the fold
      if (!open.has(key)) reveal(() => proofs.current.get(key));
      toggle(key);
    },
    at: (node: HTMLDivElement | null) => {
      if (node) proofs.current.set(key, node);
      else proofs.current.delete(key);
    },
  });

  // what agents attached, without the output of gates and commands: that is shown with its lane.
  // A gate that compares with the base commit keeps that run's output beside its own.
  const baseOf = (output: string) => output.replace(/\.log$/, ".base.log");
  const outputs = new Set(
    detail?.lanes.flatMap((l) => [...l.gates.flatMap((g) => [g.output, baseOf(g.output)]), l.output]),
  );
  // a lane entered twice attaches twice: each file then says which time it is from
  const times = new Map<number, string>();
  for (const lane of detail?.lanes ?? []) {
    const same = detail?.lanes.filter((l) => l.lane === lane.lane) ?? [];
    times.set(
      lane.id,
      same.length > 1 ? `${nameOf(lane.lane)}, round ${same.indexOf(lane) + 1}` : nameOf(lane.lane),
    );
  }
  const from = (visit: number | undefined) => times.get(visit ?? 0) ?? "";
  const groups = groupEvidence((detail?.files ?? []).filter((f) => !outputs.has(f.path)));
  // where a claim's reference leads: the row that shows its file (a pair's row for either of its two)
  const rowOf = new Map<string, string>();
  for (const pair of groups.pairs)
    for (const side of [pair.before, pair.after]) rowOf.set(side.path, pair.before.path);
  const show = (path: string) => {
    const key = rowOf.get(path) ?? path;
    setOpen(new Set(open).add("attached").add(key));
    reveal(() => proofs.current.get(key));
  };
  const attached =
    groups.pairs.length +
    groups.recordings.length +
    groups.images.length +
    groups.texts.length +
    groups.others.length;

  return (
    <section className="rundetail" aria-label={`Run of ${row.task}`}>
      <RunHeader
        row={row}
        detail={detail}
        headRef={headRef}
        onBack={onBack}
        back={back}
        deciding={deciding}
        asking={asking}
        laneName={nameOf(row.at ?? "")}
        gateWords={
          stopGate && what(stopGate.gate) ? { id: stopGate.gate, what: what(stopGate.gate) ?? "" } : undefined
        }
      />
      {detail && !deciding ? <Waits detail={detail} runId={row.id} nameOf={nameOf} /> : null}

      {detail && lead ? (
        <Lead
          item={lead}
          detail={detail}
          lane={first}
          name={nameOf(first?.lane ?? "")}
          round={roundOf(first)}
          runId={row.id}
          proof={proof}
          show={show}
          what={what}
          changed={changed}
          showDiff={showDiff}
        />
      ) : null}
      {floor ? (
        <div className="runmap">
          <div className="map-scroll" ref={scroller}>
            <Diagram
              floor={floor}
              selected={station}
              // a station leads to what the run did there
              onSelect={(id) => {
                setStation(id);
                if (id) blocks.current.get(id)?.scrollIntoView({ block: "nearest" });
              }}
              states={states}
              route={routeOf(floor.lines, row.visits, step, end)}
              trains={
                track.here
                  ? [
                      {
                        lane: track.here,
                        label: String(row.taskId),
                        title: `${row.task}. ${row.sentence}`,
                        // the line moves only at the last step of a run that is working
                        working: step === total && row.status === "running",
                        visits: row.visits,
                        // yellow while it waits for a person, as on the floor, and only at the last step
                        asks:
                          step === total &&
                          (row.stopCode === "awaiting_approval" || row.stopCode === "needs_person"),
                      },
                    ]
                  : []
              }
            />
          </div>
          <label className="scrub">
            <span className="label">Replay</span>
            <input
              type="range"
              min={0}
              max={total}
              step={1}
              value={step}
              disabled={total === 0}
              aria-label="Replay the run, step by step"
              aria-valuetext={stepWords}
              // back on the last step, the control follows the run again
              onChange={(event) =>
                setAt(Number(event.target.value) === total ? undefined : Number(event.target.value))
              }
            />
            <output className="data">{stepWords}</output>
          </label>
        </div>
      ) : row.own && !detail && !problem ? null : (
        <p className="quiet">
          The workflow "{row.workflow}" cannot be drawn any more, so this run has no map.
        </p>
      )}
      {floor && !row.own ? (
        <p className="quiet">
          This run is older than the record of the workflow it ran on: the map is "{row.workflow}" as it is
          today.
        </p>
      ) : null}

      {problem ? <p className="quiet">{problem}</p> : null}
      {detail ? (
        <>
          {lead && detail.lanes.length < 2 ? null : (
            <div className="block">
              <h3>What each lane did</h3>
              <ol className="visits">
                {detail.lanes
                  .filter((lane) => lane !== first)
                  .map((lane) => (
                    <li
                      key={lane.id}
                      ref={(node) => {
                        if (node) blocks.current.set(lane.lane, node);
                      }}
                    >
                      <LaneVisit
                        lane={lane}
                        name={nameOf(lane.lane)}
                        round={roundOf(lane)}
                        runId={row.id}
                        files={detail.files}
                        proof={proof}
                        show={show}
                        what={what}
                        says={says}
                        changed={changed}
                        showDiff={showDiff}
                      />
                    </li>
                  ))}
              </ol>
              {detail.lanes.length === 0 ? (
                <p className="quiet">This run has not entered a lane yet.</p>
              ) : null}
            </div>
          )}

          <div className="block">
            <h3>What it changed</h3>
            <Proof {...proof("diff")} label="The diff of the whole run" meta={detail.branch}>
              <DiffView runId={row.id} stamp={stamp} />
            </Proof>
          </div>

          {attached > 0 ? (
            <div className="block">
              <h3>Files the agents attached</h3>
              <Proof {...proof("attached")} label={`${attached} ${attached === 1 ? "file" : "files"}`}>
                {groups.pairs.map((pair) => (
                  <Proof
                    key={pair.before.path}
                    {...proof(pair.before.path)}
                    label={`Before and after${pair.name ? `: ${pair.name}` : ""}`}
                    meta={from(pair.before.visit)}
                  >
                    <PairView runId={row.id} before={pair.before} after={pair.after} />
                  </Proof>
                ))}
                {[
                  ...groups.recordings.map((f) => ({ f, word: "Recording" })),
                  ...groups.images.map((f) => ({ f, word: "Screenshot" })),
                  ...groups.texts.map((f) => ({ f, word: "File" })),
                  ...groups.others.map((f) => ({ f, word: "File" })),
                ].map(({ f, word }) => (
                  <Proof key={f.path} {...proof(f.path)} label={`${word}: ${f.name}`} meta={from(f.visit)}>
                    <FileView runId={row.id} path={f.path} name={f.name} />
                  </Proof>
                ))}
              </Proof>
            </div>
          ) : null}
        </>
      ) : problem ? null : (
        <p className="quiet">Reading the run.</p>
      )}
    </section>
  );
}
