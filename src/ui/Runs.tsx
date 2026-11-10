// Runs: every task the factory has taken, the newest first. Each row is the task, its strip map
// and one sentence about what is happening now. The list follows the record by itself. Beside it
// is the run that is chosen, with its map and its evidence. The arrow keys move through the
// list, and Enter goes into the run.
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { drawable } from "../core/floor/layout.ts";
import { trackOf } from "../core/runs/track.ts";
import type { Workflow } from "../core/schema/workflow.ts";
import { getWorkflow, type RunRow } from "./api.ts";
import { useRuns } from "./live.ts";
import { RunView } from "./RunDetail.tsx";
import { Strip } from "./Strip.tsx";
import { ago, cost, standing, tokens } from "./words.ts";
import "./runs.css";

/** Each workflow the runs name, as far as it can be drawn. Read once for each name. */
export function useWorkflows(runs: RunRow[] | undefined): Record<string, Workflow | undefined> {
  const [known, setKnown] = useState<Record<string, Workflow | undefined>>({});
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const name of new Set(runs?.map((r) => r.workflow))) {
      if (asked.current.has(name)) continue;
      asked.current.add(name);
      getWorkflow(name).then(({ status, body }) =>
        setKnown((before) => ({ ...before, [name]: status === 200 ? drawable(body.workflow) : undefined })),
      );
    }
  }, [runs]);
  return known;
}

export function Runs() {
  const { runs, live } = useRuns();
  const workflows = useWorkflows(runs);
  const [chosen, setChosen] = useState<string>();
  const [inside, setInside] = useState(false); // on a narrow screen the run is shown in place of the list
  const rows = useRef(new Map<string, HTMLDivElement>());
  const head = useRef<HTMLHeadingElement>(null);
  const current = runs?.find((r) => r.id === chosen) ?? runs?.[0];
  // the run that is shown stays the one shown: a run that starts must not take its place
  useEffect(() => {
    if (runs && !runs.some((r) => r.id === chosen)) setChosen(runs[0]?.id);
  }, [runs, chosen]);
  const count = useMemo(() => {
    const all = runs ?? [];
    const yours = all.filter((r) => standing(r).mark === "asked").length;
    const moving = all.filter((r) => r.status === "running").length;
    return [
      yours ? `${yours} ${yours === 1 ? "waits" : "wait"} for you` : "",
      moving ? `${moving} moving` : "",
      `${all.length} shown`,
    ]
      .filter(Boolean)
      .join(", ");
  }, [runs]);

  const enter = (id: string) => {
    setChosen(id);
    setInside(true);
    requestAnimationFrame(() => head.current?.focus());
  };
  const onKey = (event: KeyboardEvent, at: number) => {
    const list = runs ?? [];
    const to =
      event.key === "ArrowDown"
        ? at + 1
        : event.key === "ArrowUp"
          ? at - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? list.length - 1
              : undefined;
    const next = to === undefined ? undefined : list[to];
    if (next) {
      setChosen(next.id);
      rows.current.get(next.id)?.focus();
    } else if (event.key === "Enter" || event.key === " ") enter(list[at]?.id ?? "");
    else if (to === undefined) return;
    event.preventDefault();
  };

  return (
    <main className="work">
      <div className="topbar">
        <div className="where">
          <h1>Runs</h1>
          {runs ? <span>{count}</span> : null}
        </div>
        <div className="group push">
          {live ? null : (
            <span className="status bad" role="status">
              Not connected to the factory. Trying again.
            </span>
          )}
        </div>
      </div>
      {!runs ? (
        <div className="plain">
          <p>Reading the runs.</p>
        </div>
      ) : runs.length === 0 ? (
        <div className="plain">
          <p>No task has run yet.</p>
          <p>
            Start one from your terminal with <code>softwarefactor run</code>. It shows here as soon as it
            starts.
          </p>
        </div>
      ) : (
        <div className="runs" data-inside={inside}>
          <div className="runlist" role="listbox" aria-label="Runs, the newest first">
            {runs.map((run, at) => {
              const flow = workflows[run.workflow];
              const names = new Map(flow?.lanes.map((l) => [l.id, l.name ?? l.id]));
              const track = trackOf(flow?.lanes.map((l) => l.id) ?? [], run.visits, undefined, run.at);
              const stands = standing(run);
              return (
                <div
                  key={run.id}
                  ref={(node) => {
                    if (node) rows.current.set(run.id, node);
                    else rows.current.delete(run.id);
                  }}
                  role="option"
                  className="run"
                  aria-selected={run.id === current?.id}
                  tabIndex={run.id === current?.id ? 0 : -1}
                  onClick={() => enter(run.id)}
                  onKeyDown={(event) => onKey(event, at)}
                >
                  <span className={`mark ${stands.mark}`} role="img" aria-label={stands.word} />
                  <span className="task">{run.task || run.id}</span>
                  <span className="when data">{ago(run.startedAt)}</span>
                  <Strip track={track} nameOf={(id) => names.get(id) ?? id} />
                  <span className="spent data">
                    {run.tokens > 0 ? `${tokens(run.tokens)}, ${cost(run.usd, run.usdUnknown)}` : ""}
                  </span>
                  <span className="sentence">{run.sentence}</span>
                </div>
              );
            })}
          </div>
          {current ? (
            <RunView
              key={current.id}
              row={current}
              workflow={workflows[current.workflow]}
              headRef={head}
              onBack={() => {
                setInside(false);
                requestAnimationFrame(() => rows.current.get(current.id)?.focus());
              }}
            />
          ) : null}
        </div>
      )}
    </main>
  );
}
