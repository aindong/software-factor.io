// One run: its sentence, the run drawn on the workflow's map with a control that steps through
// it, what waits for a person, the diff, the files its agents attached, and each lane it went
// through with its gates, claims and sessions. Every piece of evidence opens in place.
import { type RefObject, useEffect, useMemo, useState } from "react";
import { layout } from "../core/floor/layout.ts";
import { groupEvidence, routeOf, stepOf, trackOf } from "../core/runs/track.ts";
import type { Workflow } from "../core/schema/workflow.ts";
import { getRun, type RunDetail, type RunRow } from "./api.ts";
import { Diagram } from "./Diagram.tsx";
import { DiffView, FileView, PairView, Proof } from "./Evidence.tsx";
import { STATE_WORD } from "./Strip.tsx";
import { ago, cost, span, tokens } from "./words.ts";

const OUTCOME = { pass: "pass", fail: "fail", needsPerson: "asked" } as const;
const stateOf = (outcome: keyof typeof OUTCOME | null) => (outcome ? OUTCOME[outcome] : "here");

export interface RunViewProps {
  row: RunRow;
  workflow: Workflow | undefined;
  headRef: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
}

export function RunView({ row, workflow, headRef, onBack }: RunViewProps) {
  const [detail, setDetail] = useState<RunDetail>();
  const [problem, setProblem] = useState<string>();
  const [at, setAt] = useState<number>(); // the step shown: the latest, until the control is moved
  const [open, setOpen] = useState<string>();
  const [station, setStation] = useState<string>();
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

  const floor = useMemo(() => (workflow ? layout(workflow) : undefined), [workflow]);
  const names = new Map(workflow?.lanes.map((l) => [l.id, l.name ?? l.id]));
  const nameOf = (id: string) => names.get(id) ?? id;
  const total = row.visits.length;
  const step = stepOf(total, at);
  // the end the run came to: a run a person stopped after its last lane passed did not come to Done
  const end = { done: "@done", dropped: "@drop", stopped: "@stop", running: undefined, waiting: undefined }[
    row.status
  ];
  const track = trackOf(workflow?.lanes.map((l) => l.id) ?? [], row.visits, step, row.at);
  const states = Object.fromEntries(track.lanes.map((l) => [l.id, l.state]));
  const visit = row.visits[step - 1];
  const stepWords =
    step === 0
      ? "Before the first lane"
      : `Step ${step} of ${total}: ${nameOf(visit?.lane ?? "")} ${STATE_WORD[stateOf(visit?.outcome ?? null)]}`;
  const toggle = (key: string) => setOpen(open === key ? undefined : key);
  const proof = (key: string) => ({ open: open === key, onToggle: () => toggle(key) });

  // what agents attached, without the output of gates and commands: that is shown with its lane
  const outputs = new Set(detail?.lanes.flatMap((l) => [...l.gates.map((g) => g.output), l.output]));
  // a lane entered twice attaches twice: each file then says which time it is from
  const times = new Map<number, string>();
  for (const lane of detail?.lanes ?? []) {
    const same = detail?.lanes.filter((l) => l.lane === lane.lane) ?? [];
    times.set(
      lane.id,
      same.length > 1 ? `${nameOf(lane.lane)}, time ${same.indexOf(lane) + 1}` : nameOf(lane.lane),
    );
  }
  const from = (visit: number | undefined) => times.get(visit ?? 0) ?? "";
  const groups = groupEvidence((detail?.files ?? []).filter((f) => !outputs.has(f.path)));
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
          All runs
        </button>
        <h2 ref={headRef} tabIndex={-1}>
          {row.task || row.id}
        </h2>
        <p className="sentence" role="status">
          {row.sentence}
        </p>
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
          <div>
            <dt>Used</dt>
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

      {detail?.inbox.map((item) => (
        <p key={item.id} className="waits">
          <span className="mark asked" aria-hidden="true" />
          <span>
            {item.kind === "question"
              ? `${nameOf(item.lane)} asks: ${item.body}`
              : `${nameOf(item.lane)} waits for your approval.`}{" "}
            From your terminal:{" "}
            <code>
              {item.kind === "question"
                ? `softwarefactor answer ${row.id} --note "..."`
                : `softwarefactor approve ${row.id}`}
            </code>
          </span>
        </p>
      ))}

      {floor ? (
        <div className="runmap">
          <div className="map-scroll">
            <Diagram
              floor={floor}
              selected={station}
              onSelect={setStation}
              states={states}
              route={routeOf(floor.lines, row.visits, step, end)}
              trains={
                track.here
                  ? [{ lane: track.here, label: String(row.taskId), title: `${row.task}. ${row.sentence}` }]
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
      ) : (
        <p className="quiet">
          The workflow "{row.workflow}" cannot be drawn any more, so this run has no map.
        </p>
      )}

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
                <li key={lane.id}>
                  <div className="visit">
                    <span className={`mark ${stateOf(lane.outcome)}`} aria-hidden="true" />
                    <strong>{nameOf(lane.lane)}</strong>
                    <span>{STATE_WORD[stateOf(lane.outcome)]}</span>
                    <span className="data spent">
                      {[
                        lane.durationMs ? span(lane.durationMs) : "",
                        lane.tokens ? tokens(lane.tokens) : "",
                        lane.usd ? `$${lane.usd.toFixed(2)}` : "",
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
                          {claim.evidence.map((e) => (
                            <code key={e.ref} className="ref">
                              {e.ref}
                            </code>
                          ))}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {lane.gates.map((gate) => (
                    <Proof
                      key={gate.output}
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
                        gate.attempt > 1 ? `check ${gate.attempt}` : "",
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    >
                      {gate.command ? <p className="quiet code">$ {gate.command}</p> : null}
                      <FileView runId={row.id} path={gate.output} name="output.log" />
                    </Proof>
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
                        label={`What the agent printed${lane.sessions.length > 1 ? `, start ${i + 1}` : ""}`}
                        meta={[
                          session.account ?? session.agent,
                          session.model ?? "",
                          tokens(session.tokens),
                          session.usd === null ? "cost not known" : `$${session.usd.toFixed(2)}`,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      >
                        <FileView runId={row.id} path={session.transcript} name="transcript.jsonl" />
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
