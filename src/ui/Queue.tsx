// A quiet strip under the Floor's map: the runs that are working now (each a link to its page) and the
// tasks that are queued, each with the button that starts it, as `softwarefactor run --task` does. The
// line of counts above says how many wait for the person; this only says what is going on and what is next.
import { useState } from "react";
import { op, type Queued, type RunRow } from "./api.ts";
import { go } from "./route.ts";

const SHOWN = 5; // the line of counts has the whole number

export function Queue({ runs, queued }: { runs: RunRow[]; queued: Queued[] }) {
  const [said, setSaid] = useState<{ text: string; bad: boolean }>();
  const [starting, setStarting] = useState<string>();
  const working = runs.filter((r) => r.status === "running");
  if (working.length === 0 && queued.length === 0) return null;
  const start = async (task: Queued) => {
    if (starting) return;
    setStarting(task.key);
    const { status, body } = await op<{ said?: string }>("runs_start", { task: task.key });
    setStarting(undefined);
    setSaid(
      status === 200
        ? undefined // the line of counts and the list change by themselves
        : {
            text: `Not started: ${task.title}. ${body.error ?? "The factory did not take it."} ${body.fix ?? ""}`.trim(),
            bad: true,
          },
    );
  };
  return (
    <section className="queue" aria-label="Working now and queued">
      <ul>
        {working.map((run) => (
          <li key={run.id} className="working">
            <a
              href={`/runs/${run.id}`}
              onClick={(event) => {
                event.preventDefault();
                go(`/runs/${run.id}`);
              }}
            >
              {run.task}
            </a>
            <span className="state">Working</span>
          </li>
        ))}
        {queued.slice(0, SHOWN).map((task) => (
          <li key={task.key} className="queued">
            <span className="task">{task.title}</span>
            <span className="state">queued</span>
            <button
              type="button"
              className="button"
              aria-label={`Run ${task.title}`}
              title={`softwarefactor run --task ${task.key}`}
              disabled={starting !== undefined}
              onClick={() => start(task)}
            >
              {starting === task.key ? "Starting..." : "Run"}
            </button>
          </li>
        ))}
      </ul>
      {queued.length > SHOWN ? <p className="more">and {queued.length - SHOWN} more queued</p> : null}
      {said ? (
        <p className="note bad" role="alert">
          {said.text}
        </p>
      ) : null}
    </section>
  );
}
