// What a person can do to a run from its page: stop one that is working (after one question, asked in
// place), put the task of one that stopped back in the queue. Each is an operation of the server, the
// same the command line's `stop` and `requeue` are; the answer is said in the page's status line.
import { type RefObject, useRef, useState } from "react";
import type { RunRow } from "./api.ts";
import { op } from "./api.ts";

export interface Said {
  text: string;
  bad: boolean;
}

export function RunActions(props: {
  row: RunRow;
  headRef: RefObject<HTMLHeadingElement | null>;
  say: (said: Said) => void;
}) {
  const { row, say } = props;
  const [doing, setDoing] = useState<"stop" | "again">();
  const [asking, setAsking] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  const again = row.status === "stopped" || row.status === "dropped";
  if (!again && row.status !== "running") return null;
  // once the task is in the queue the button has done its work: the page says what starts it
  if (again && row.taskStatus === "queued") return null;

  const act = async (name: "runs_stop" | "runs_requeue", done: string, not: string) => {
    if (doing) return;
    setDoing(name === "runs_stop" ? "stop" : "again");
    const { status, body } = await op(name, { run: row.id });
    setDoing(undefined);
    setAsking(false);
    say(
      status === 200
        ? { text: done, bad: false }
        : {
            text: `${not}: ${row.task}. ${body.error ?? "The factory did not take it."} ${body.fix ?? ""}`.trim(),
            bad: true,
          },
    );
    // the button that was pressed may be gone: the keyboard goes to the page's heading
    requestAnimationFrame(() => props.headRef.current?.focus());
  };
  const ask = () => {
    setAsking(true);
    requestAnimationFrame(() => keep.current?.focus());
  };

  return (
    <div className="actions">
      {again ? (
        <>
          <button
            type="button"
            className="button primary"
            disabled={doing === "again"}
            onClick={() =>
              act(
                "runs_requeue",
                "", // the page's status line then says that the task is queued, and what starts it
                "Not put back in the queue",
              )
            }
          >
            {doing === "again" ? "Putting back..." : "Put back in the queue"}
          </button>
          <span className="quiet">
            or in your terminal: <code>softwarefactor requeue {row.id}</code>
          </span>
        </>
      ) : asking ? (
        <fieldset
          className="ask"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            setAsking(false);
            event.stopPropagation();
            requestAnimationFrame(() => props.headRef.current?.focus());
          }}
        >
          <legend>Stop this run? It ends where it is.</legend>
          <button type="button" className="button" ref={keep} onClick={() => setAsking(false)}>
            Keep it working
          </button>
          <button
            type="button"
            className="button"
            disabled={doing === "stop"}
            onClick={() => act("runs_stop", `Stopped: ${row.task}.`, "Not stopped")}
          >
            {doing === "stop" ? "Stopping..." : "Yes, stop it"}
          </button>
        </fieldset>
      ) : (
        <>
          <button type="button" className="button" onClick={ask}>
            Stop
          </button>
          <span className="quiet">
            or in your terminal: <code>softwarefactor stop {row.id}</code>
          </span>
        </>
      )}
    </div>
  );
}
