// The head of a run's page: its title, what it is doing or how it ended in plain words, whether it needs a
// person, and a short line of facts. The run's id and branch, which only a developer looks for, come last.
import { type ReactNode, type RefObject, useState } from "react";
import { QUEUED } from "../core/runs/sentence.ts";
import type { RunDetail, RunRow } from "./api.ts";
import { Elapsed } from "./Elapsed.tsx";
import { RunActions, type Said } from "./RunActions.tsx";
import { go } from "./route.ts";
import { State } from "./State.tsx";
import { pageSays } from "./says.ts";
import { Coded } from "./Words.tsx";
import { ago, cost, howLong, lede } from "./words.ts";

export function RunHeader(props: {
  row: RunRow;
  detail: RunDetail | undefined;
  headRef: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
  back: string;
  deciding: boolean | undefined;
  asking: boolean;
  laneName: string;
  /** What the gate that stopped the run checks, in the workflow's own words, with the gate's id. */
  gateWords?: { id: string; what: string };
  /** What waits for a person, with the way to decide: the first thing under the title, before the facts. */
  children?: ReactNode;
}) {
  const { row, detail } = props;
  const [told, setTold] = useState<Said>();
  const said = lede(row, props.laneName);
  const queued = row.taskStatus === "queued" && (row.status === "stopped" || row.status === "dropped");
  const more = pageSays(row);
  // a run that waits says so in the block that holds the way to decide, which is yellow and follows: the head keeps its state
  const hold = said.needs && (!detail || props.asking);
  return (
    <header>
      <button type="button" className="button back" onClick={props.onBack}>
        {props.back}
      </button>
      <h2 ref={props.headRef} tabIndex={-1}>
        <Coded sentence={row.task || row.id} />
      </h2>
      {/* in the inbox the decision bar above says this already */}
      {props.deciding ? null : (
        <>
          <State run={row} />
          {hold && !told?.text ? null : (
            <p className="lede" role="status">
              {hold ? null : said.says}{" "}
              <span className={said.needs ? "needs" : "quiet"}>
                {hold ? null : queued ? <Coded sentence={QUEUED} /> : said.line}
              </span>
              {told?.text ? <span className={told.bad ? "needs" : ""}> {told.text}</span> : null}
            </p>
          )}
          {/* what waits says it in its own block below, with the way to decide; the sentence is the record's own, for a developer */}
          {props.asking || !more ? null : (
            <p className="sentence quiet">
              {row.status === "running" ? "Latest: " : ""}
              {more}
            </p>
          )}
          {props.gateWords && row.status !== "running" ? (
            <p className="quiet gate-words">
              That gate, {props.gateWords.id}, checks: {props.gateWords.what}
            </p>
          ) : null}
        </>
      )}
      {props.children}
      {props.deciding ? null : <RunActions row={row} headRef={props.headRef} say={setTold} />}
      <dl className="facts">
        <div>
          <dt>Started</dt>
          <dd>{ago(row.startedAt)}</dd>
        </div>
        {row.endedAt ? (
          <div>
            <dt>Took</dt>
            <dd>{howLong(Date.parse(row.endedAt) - Date.parse(row.startedAt))}</dd>
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
          <dt>{row.status === "running" ? "Cost so far" : "Cost"}</dt>
          <dd>{cost(row.usd, row.usdUnknown)}</dd>
        </div>
      </dl>
      <dl className="facts ids">
        <div>
          <dt>Run</dt>
          <dd className="code">{row.id}</dd>
        </div>
        {detail ? (
          <div>
            <dt>Branch</dt>
            <dd className="code">{detail.branch}</dd>
          </div>
        ) : null}
      </dl>
    </header>
  );
}

export function Waits({
  detail,
  runId,
  nameOf,
}: {
  detail: RunDetail;
  runId: string;
  nameOf: (id: string) => string;
}) {
  return detail.inbox.map((item) => (
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
            href={`/inbox/${runId}`}
            onClick={(event) => {
              event.preventDefault();
              go(`/inbox/${runId}`);
            }}
          >
            Decide in the inbox
          </a>{" "}
          <span className="quiet">
            or from your terminal:{" "}
            <code>
              {item.kind === "question"
                ? `softwarefactor answer ${runId} --note "..."`
                : `softwarefactor approve ${runId}`}
            </code>
          </span>
        </p>
      </div>
    </div>
  ));
}
