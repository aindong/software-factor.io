// One run: its sentence, the run drawn on the workflow's map with a control that steps through
// it, what waits for a person, the diff, the files its agents attached, and each lane it went
// through with its gates, claims and sessions. Every piece of evidence opens in place.
import { Fragment, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { drawable, layout } from "../core/floor/layout.ts";
import { groupEvidence, routeOf, stepOf, trackOf } from "../core/runs/track.ts";
import { memberOf } from "../core/runs/transcript.ts";
import type { Workflow } from "../core/schema/workflow.ts";
import { getRun, type RunDetail, type RunRow } from "./api.ts";
import { Diagram } from "./Diagram.tsx";
import { Elapsed } from "./Elapsed.tsx";
import { DiffView, FileView, PairView, Proof } from "./Evidence.tsx";
import { go } from "./route.ts";
import { State } from "./State.tsx";
import { STATE_WORD } from "./Strip.tsx";
import { TranscriptView } from "./Transcript.tsx";
import { ago, cost, dollars, span, standing, tokens } from "./words.ts";

const OUTCOME = { pass: "pass", fail: "fail", needsPerson: "asked" } as const;
const stateOf = (outcome: keyof typeof OUTCOME | null) => (outcome ? OUTCOME[outcome] : "here");

export interface RunViewProps {
  row: RunRow;
  workflow: Workflow | undefined;
  headRef: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
  /** What the way back is called, on a narrow screen. */
  back?: string;
  /** The screen around it already asks for the decision: do not name the command for it too. */
  deciding?: boolean;
}

export function RunView({ row, workflow, headRef, onBack, back = "All runs", deciding }: RunViewProps) {
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
  // On a narrow screen the map is wider than the window: show where the run is, or where it ended
  // biome-ignore lint/correctness/useExhaustiveDependencies: when the run moves or its map is drawn
  useEffect(() => {
    const view = scroller.current;
    const end = { done: "done", stopped: "stop", dropped: "drop" }[row.status as string];
    const mark = view?.querySelector(end ? `.station.end.${end}` : '.station[aria-label*=" is here"]');
    if (!view || !mark) return;
    const at = mark.getBoundingClientRect();
    const box = view.getBoundingClientRect();
    view.scrollLeft += at.left - box.left - (box.width - at.width) / 2;
  }, [row.status, row.at, floor]);
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
      : `Step ${step} of ${total}: ${nameOf(visit?.lane ?? "")} ${STATE_WORD[stateOf(visit?.outcome ?? null)]}`;
  const toggle = (key: string) => {
    const next = new Set(open);
    if (!next.delete(key)) next.add(key);
    setOpen(next);
  };
  const proof = (key: string) => ({
    open: open.has(key),
    onToggle: () => toggle(key),
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
    setOpen(new Set(open).add(key));
    requestAnimationFrame(() => proofs.current.get(key)?.scrollIntoView({ block: "nearest" }));
  };
  const attached =
    groups.pairs.length +
    groups.recordings.length +
    groups.images.length +
    groups.texts.length +
    groups.others.length;

  return (
    <section className="rundetail" aria-label={`Run of ${row.task}`}>
      <header>
        <button type="button" className="button back" onClick={onBack}>
          {back}
        </button>
        <h2 ref={headRef} tabIndex={-1}>
          {row.task || row.id}
        </h2>
        {/* in the inbox the decision bar above says this already */}
        {deciding ? null : (
          <>
            <State run={row} />
            {/* what waits says it in its own block below, with the way to decide */}
            {asking ? null : (
              <p className="sentence" role="status">
                {row.sentence}
              </p>
            )}
          </>
        )}
        <dl className="facts data">
          <div>
            <dt>Run</dt>
            <dd className="code">{row.id}</dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{ago(row.startedAt)}</dd>
          </div>
          {row.endedAt ? (
            <div>
              <dt>Took</dt>
              <dd>{span(Date.parse(row.endedAt) - Date.parse(row.startedAt))}</dd>
            </div>
          ) : null}
          {row.workingSince ? (
            <div>
              <dt>Working for</dt>
              <dd className="elapsed">
                <Elapsed since={row.workingSince} />
              </dd>
            </div>
          ) : null}
          {row.workingSince && row.lastAt ? (
            <div>
              <dt>Last output</dt>
              <dd className="elapsed">
                <Elapsed since={row.lastAt} /> ago
              </dd>
            </div>
          ) : null}
          <div>
            <dt>{row.status === "running" ? "Used so far" : "Used"}</dt>
            <dd>
              {tokens(row.tokens)}, {cost(row.usd, row.usdUnknown)}
            </dd>
          </div>
          {detail ? (
            <div>
              <dt>Branch</dt>
              <dd className="code">{detail.branch}</dd>
            </div>
          ) : null}
        </dl>
      </header>

      {(deciding ? [] : (detail?.inbox ?? [])).map((item) => (
        <div key={item.id} className="waits">
          <span className="mark asked" aria-hidden="true" />
          <div>
            <p>
              {item.kind === "question"
                ? `${nameOf(item.lane)} asks: ${item.body}`
                : `${nameOf(item.lane)} waits for your approval.`}
            </p>
            <p>
              <a
                className="button approve"
                href={`/inbox/${row.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  go(`/inbox/${row.id}`);
                }}
              >
                Decide in the inbox
              </a>{" "}
              <span className="quiet">
                or from your terminal:{" "}
                <code>
                  {item.kind === "question"
                    ? `softwarefactor answer ${row.id} --note "..."`
                    : `softwarefactor approve ${row.id}`}
                </code>
              </span>
            </p>
          </div>
        </div>
      ))}

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
          <div className="block">
            <h3>What it changed</h3>
            <Proof {...proof("diff")} label="The diff of the whole run" meta={detail.branch}>
              <DiffView runId={row.id} stamp={stamp} />
            </Proof>
          </div>

          {attached > 0 ? (
            <div className="block">
              <h3>What its agents attached</h3>
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
            </div>
          ) : null}

          <div className="block">
            <h3>Lane by lane</h3>
            <ol className="visits">
              {detail.lanes.map((lane) => (
                <li
                  key={lane.id}
                  ref={(node) => {
                    if (node) blocks.current.set(lane.lane, node);
                  }}
                >
                  <div className="visit">
                    <span className={`mark ${stateOf(lane.outcome)}`} aria-hidden="true" />
                    <strong>{nameOf(lane.lane)}</strong>
                    <span>{STATE_WORD[stateOf(lane.outcome)]}</span>
                    <span className="data spent">
                      {[
                        lane.durationMs ? span(lane.durationMs) : "",
                        lane.tokens ? tokens(lane.tokens) : "",
                        lane.usd ? dollars(lane.usd) : "",
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </div>
                  {lane.note ? <p className="note">{lane.note}</p> : null}
                  {lane.claims.length > 0 ? (
                    <ul className="claims">
                      {lane.claims.map((claim) => (
                        <li key={claim.text}>
                          {claim.text}{" "}
                          {claim.evidence.length === 0 ? (
                            <span className="quiet">no evidence given</span>
                          ) : null}
                          {claim.evidence.map((e) => (
                            // each reference says whether the host found what it names, and opens it when it is a file
                            <span key={e.ref} className="ref code">
                              <span
                                className={`mark ${e.ok ? "pass" : "fail"}`}
                                role="img"
                                aria-label={e.ok ? "The host checked this:" : "The host did not find this:"}
                              />
                              {e.path ? (
                                <button type="button" onClick={() => show(e.path ?? "")}>
                                  {e.ref}
                                </button>
                              ) : (
                                e.ref
                              )}
                            </span>
                          ))}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {lane.gates.map((gate) => (
                    <Fragment key={gate.output}>
                      <Proof
                        {...proof(gate.output)}
                        mark={
                          <span
                            className={`mark ${gate.status === "pass" ? "pass" : "fail"}`}
                            aria-hidden="true"
                          />
                        }
                        label={`Gate ${gate.gate} ${gate.status === "pass" ? "passed" : "failed"}`}
                        meta={[
                          gate.exitCode === null ? "" : `exit ${gate.exitCode}`,
                          span(gate.durationMs),
                          gate.attempt > 1 ? `round ${gate.attempt}` : "",
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      >
                        <FileView runId={row.id} path={gate.output} name="output.log" />
                      </Proof>
                      {detail.files.some((f) => f.path === baseOf(gate.output)) ? (
                        <Proof {...proof(baseOf(gate.output))} label={`Gate ${gate.gate} on the base commit`}>
                          <FileView runId={row.id} path={baseOf(gate.output)} name="output.log" />
                        </Proof>
                      ) : null}
                    </Fragment>
                  ))}
                  {lane.output ? (
                    <Proof {...proof(lane.output)} label="What its command printed">
                      <FileView runId={row.id} path={lane.output} name="output.log" />
                    </Proof>
                  ) : null}
                  {lane.handoff ? (
                    <Proof {...proof(lane.handoff)} label="Hand-off">
                      <FileView runId={row.id} path={lane.handoff} name="handoff.json" />
                    </Proof>
                  ) : null}
                  {lane.sessions.map((session, i) =>
                    session.transcript ? (
                      <Proof
                        key={session.transcript}
                        {...proof(session.transcript)}
                        label={`What the agent printed${memberOf(session.transcript) ? `: ${memberOf(session.transcript)}` : lane.sessions.length > 1 ? `, try ${i + 1}` : ""}`}
                        meta={[
                          session.account ?? session.agent,
                          session.model ?? "",
                          tokens(session.tokens),
                          session.usd === null ? "cost not known" : dollars(session.usd),
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      >
                        <TranscriptView runId={row.id} path={session.transcript} />
                      </Proof>
                    ) : null,
                  )}
                </li>
              ))}
            </ol>
            {detail.lanes.length === 0 ? <p className="quiet">This run has not entered a lane yet.</p> : null}
          </div>
        </>
      ) : problem ? null : (
        <p className="quiet">Reading the run.</p>
      )}
    </section>
  );
}
