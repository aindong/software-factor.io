// Runs: every task the factory has taken, the newest first. Each row is the task, its strip map
// and one sentence about what is happening now. The list follows the record by itself. Beside it
// is the run that is chosen, with its map and its evidence. The arrow keys move through the
// list, and Enter goes into the run. The filter by state is in the address (`?show=working`); a run
// that is open stays open when it no longer matches, and the list says so.
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { drawable } from "../core/floor/layout.ts";
import { trackOf } from "../core/runs/track.ts";
import type { Workflow } from "../core/schema/workflow.ts";
import { getWorkflow, type RunRow } from "./api.ts";
import { Elapsed } from "./Elapsed.tsx";
import { emptyWords, kept, readShow, shownRuns, withShow } from "./filter.ts";
import { useRuns } from "./live.ts";
import { Offline } from "./Offline.tsx";
import { RunView } from "./RunDetail.tsx";
import { RunFilter } from "./RunFilter.tsx";
import { go, openIn, usePath, useSearch } from "./route.ts";
import { inOrder } from "./run-order.ts";
import { State } from "./State.tsx";
import { Strip } from "./Strip.tsx";
import { pageSays } from "./says.ts";
import { Coded } from "./Words.tsx";
import { ago, cost, standing, tokens } from "./words.ts";
import "./runs.css";
import "./runs-quiet.css";

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
  // The run that was entered is in the address (`/runs/<run>`): Back leaves the run, a reload
  // keeps it, and a link to it can be printed. Until one is entered, a run is only picked.
  const opened = openIn(usePath(), "/runs");
  const [picked, setPicked] = useState<string>();
  const chosen = opened ?? picked;
  const show = readShow(useSearch());
  const keep = withShow("", show); // what the address keeps after the path
  const inside = opened !== undefined; // on a narrow screen the run is shown in place of the list
  const rows = useRef(new Map<string, HTMLDivElement>());
  const head = useRef<HTMLHeadingElement>(null);
  const current = runs?.find((r) => r.id === chosen);
  const list = useMemo(() => inOrder(shownRuns(runs ?? [], show)), [runs, show]);
  // arriving from the rail: the keyboard goes to the selected row once the list is there, so the arrow keys work
  const arrived = useRef(opened === undefined);
  useEffect(() => {
    if (!arrived.current || list.length === 0) return;
    arrived.current = false;
    if (!document.activeElement?.closest("main")) rows.current.get(picked ?? list[0]?.id ?? "")?.focus();
  }, [list, picked]);
  // the run that is shown stays the one shown: a run that starts must not take its place. A run
  // that is only picked follows the filter; one that was entered stays, even if it no longer matches.
  useEffect(() => {
    if (runs && !opened && !list.some((r) => r.id === picked)) setPicked(list[0]?.id);
  }, [runs, list, picked, opened]);
  const count = useMemo(() => {
    const all = runs ?? [];
    const yours = all.filter((r) => standing(r).mark === "asked").length;
    const moving = all.filter((r) => r.status === "running").length;
    return [
      yours ? `${yours} ${yours === 1 ? "waits" : "wait"} for you` : "",
      moving ? `${moving} working` : "",
      show ? `${list.length} shown of ${all.length}` : `${all.length} shown`,
    ]
      .filter(Boolean)
      .join(", ");
  }, [runs, list, show]);

  const enter = (id: string) => {
    setPicked(id);
    go(`/runs/${encodeURIComponent(id)}${keep}`);
    requestAnimationFrame(() => head.current?.focus());
  };
  const onKey = (event: KeyboardEvent, at: number) => {
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
      setPicked(next.id);
      if (opened) go(`/runs/${encodeURIComponent(next.id)}${keep}`, true); // the address follows the run on show
      rows.current.get(next.id)?.focus();
    } else if (event.key === "Enter" || event.key === " ") enter(list[at]?.id ?? "");
    else if (to === undefined) return;
    event.preventDefault();
  };

  return (
    <main className="work">
      <div className="topbar" data-inside={inside}>
        <div className="where">
          <h1>Runs</h1>
          {runs ? <span>{count}</span> : null}
        </div>
        {runs && runs.length > 0 ? (
          <RunFilter
            runs={runs}
            show={show}
            onShow={(to) => go(withShow(opened ? `/runs/${encodeURIComponent(opened)}` : "/runs", to), true)}
          />
        ) : null}
        <div className="group push">{live ? null : <Offline />}</div>
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
          <div className="runlist">
            {show && current && !kept(current, show) ? (
              <p className="listnote">
                The open run is not among those shown: the list shows only the runs that are{" "}
                {show.replaceAll("-", " ")}.
              </p>
            ) : null}
            {list.length === 0 ? (
              <div className="plain">
                <p>{emptyWords(show ?? "")}</p>
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    go(withShow(opened ? `/runs/${encodeURIComponent(opened)}` : "/runs", undefined), true)
                  }
                >
                  Show all runs
                </button>
              </div>
            ) : (
              <>
                <p className="keyhint">
                  <kbd>↑</kbd> <kbd>↓</kbd> move between runs, <kbd>Enter</kbd> opens
                </p>
                <div role="listbox" aria-label="Runs, the newest first">
                  {list.map((run, at) => {
                    // the run's own stops, as its workflow was when it started
                    const names = new Map(run.stops.map((l) => [l.id, l.name]));
                    const track = trackOf(
                      run.stops.map((l) => l.id),
                      run.visits,
                      undefined,
                      run.at,
                    );
                    const stands = standing(run);
                    return (
                      <div
                        key={run.id}
                        ref={(node) => {
                          if (node) rows.current.set(run.id, node);
                          else rows.current.delete(run.id);
                        }}
                        role="option"
                        className="run lined"
                        data-mark={stands.mark}
                        aria-selected={run.id === current?.id}
                        tabIndex={
                          run.id === (current && kept(current, show) ? current.id : list[0]?.id) ? 0 : -1
                        }
                        onClick={() => enter(run.id)}
                        onKeyDown={(event) => onKey(event, at)}
                      >
                        <State run={run} />
                        <span className="when data">{ago(run.startedAt)}</span>
                        <span className="task" title={run.task}>
                          <span className="number data">{run.taskId}</span>{" "}
                          <Coded sentence={run.task || run.id} />
                        </span>
                        <Strip
                          track={track}
                          nameOf={(id) => names.get(id) ?? id}
                          working={stands.mark === "working"}
                        />
                        <span className="spent data">
                          {run.tokens > 0 ? `${tokens(run.tokens)}, ${cost(run.usd, run.usdUnknown)}` : ""}
                          {run.tokens > 0 && run.workingSince ? ", " : ""}
                          {run.workingSince ? (
                            <>
                              <Elapsed since={run.workingSince} /> at work
                            </>
                          ) : null}
                        </span>
                        {pageSays(run) ? (
                          <span className="sentence">
                            <Coded sentence={pageSays(run)} />
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          {current ? (
            <RunView
              key={current.id}
              row={current}
              workflow={workflows[current.workflow]}
              headRef={head}
              onBack={() => {
                setPicked(current.id);
                go(`/runs${keep}`, true); // in place of the run's address: Back does not enter it again
                requestAnimationFrame(() => rows.current.get(current.id)?.focus());
              }}
            />
          ) : opened ? (
            <div className="plain">
              <p>The run {opened} is not among the runs shown here.</p>
              <p>
                It may be older than the latest fifty. <code>softwarefactor runs {opened}</code> prints it.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </main>
  );
}
