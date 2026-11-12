// One visit of a lane, read as a person reads it: its name, how it ended and how long it took, what its
// agent said in whole sentences, and one line on its gates. The claims with their references, each
// gate's record, the hand-off and what the agent printed are one button away, in place.
import { Fragment } from "react";
import { memberOf } from "../core/runs/transcript.ts";
import type { RunDetail } from "./api.ts";
import { FileView, Proof } from "./Evidence.tsx";
import { STATE_WORD } from "./Strip.tsx";
import { TranscriptView } from "./Transcript.tsx";
import { dollars, finished, howLong, span, tokens } from "./words.ts";

type Lane = RunDetail["lanes"][number];
export interface ProofProps {
  open: boolean;
  onToggle: () => void;
  at: (node: HTMLDivElement | null) => void;
}
const OUTCOME = { pass: "pass", fail: "fail", needsPerson: "asked" } as const;
export const stateOf = (outcome: keyof typeof OUTCOME | null) => (outcome ? OUTCOME[outcome] : "here");

/** "5 gates passed", or "4 gates passed, verify failed": the line a reader needs before any record. */
export function gatesLine(gates: Lane["gates"]): string {
  if (gates.length === 0) return "";
  const failed = gates.filter((g) => g.status !== "pass");
  const word = (n: number) => `${n} ${n === 1 ? "gate" : "gates"}`;
  if (failed.length === 0) return `${word(gates.length)} passed`;
  const names = [...new Set(failed.map((g) => g.gate))].join(", ");
  return `${word(gates.length - failed.length)} passed, ${names} failed`;
}

export function LaneVisit(props: {
  lane: Lane;
  name: string;
  runId: string;
  files: RunDetail["files"];
  proof: (key: string) => ProofProps;
  show: (path: string) => void;
}) {
  const { lane, runId, files, proof, show } = props;
  const state = stateOf(lane.outcome);
  const baseOf = (output: string) => output.replace(/\.log$/, ".base.log");
  const parts = [
    lane.claims.length ? `${lane.claims.length} ${lane.claims.length === 1 ? "claim" : "claims"}` : "",
    lane.gates.length ? `${lane.gates.length} ${lane.gates.length === 1 ? "gate" : "gates"}` : "",
    lane.sessions.length ? "agent output" : "",
  ].filter(Boolean);
  const hasMore = parts.length > 0 || lane.output || lane.handoff;
  const spent = [lane.durationMs ? howLong(lane.durationMs) : "", lane.usd ? dollars(lane.usd) : ""].filter(
    Boolean,
  );
  return (
    <>
      <div className="visit">
        <span className={`mark ${state}`} aria-hidden="true" />
        <h4>{props.name}</h4>
        <span className="outcome">{STATE_WORD[state]}</span>
        <span className="spent">{spent.join(", ")}</span>
      </div>
      {lane.note ? <p className="note">{finished(lane.note)}</p> : null}
      {gatesLine(lane.gates) ? <p className="gates-line">{gatesLine(lane.gates)}</p> : null}
      {hasMore ? (
        <Proof {...proof(`lane:${lane.id}`)} label={`Evidence for ${props.name}`} meta={parts.join(", ")}>
          <p className="quiet data">
            Used{" "}
            {[lane.tokens ? tokens(lane.tokens) : "", lane.durationMs ? span(lane.durationMs) : ""]
              .filter(Boolean)
              .join(", ")}
          </p>
          {lane.claims.length > 0 ? (
            <ul className="claims">
              {lane.claims.map((claim) => (
                <li key={claim.text}>
                  {claim.text}{" "}
                  {claim.evidence.length === 0 ? <span className="quiet">no evidence given</span> : null}
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
                  <span className={`mark ${gate.status === "pass" ? "pass" : "fail"}`} aria-hidden="true" />
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
                <FileView runId={runId} path={gate.output} name="output.log" />
              </Proof>
              {files.some((f) => f.path === baseOf(gate.output)) ? (
                <Proof {...proof(baseOf(gate.output))} label={`Gate ${gate.gate} on the base commit`}>
                  <FileView runId={runId} path={baseOf(gate.output)} name="output.log" />
                </Proof>
              ) : null}
            </Fragment>
          ))}
          {lane.output ? (
            <Proof {...proof(lane.output)} label="What its command printed">
              <FileView runId={runId} path={lane.output} name="output.log" />
            </Proof>
          ) : null}
          {lane.handoff ? (
            <Proof {...proof(lane.handoff)} label="Hand-off">
              <FileView runId={runId} path={lane.handoff} name="handoff.json" />
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
                <TranscriptView runId={runId} path={session.transcript} />
              </Proof>
            ) : null,
          )}
        </Proof>
      ) : null}
    </>
  );
}
