// The fixed parts around the floor's map: what it is drawn with, in words, the buttons that add a
// lane and the fold they sit in at phone width, the trains that stand on it, and the caret's way to a lane in the JSON view.
import { type ReactNode, useState } from "react";
import type { RunRow } from "./api.ts";

/** The runs of one workflow that are moving or waiting, each as a train at its lane. */
export const trainsOf = (runs: RunRow[], workflow: string | undefined) =>
  runs
    .filter((r) => (r.status === "running" || r.status === "waiting") && r.workflow === workflow && r.at)
    .map((r) => ({
      lane: r.at ?? "",
      label: String(r.taskId),
      title: `${r.task}. ${r.sentence}`,
      working: r.status === "running",
      visits: r.visits,
      asks: r.stopCode === "awaiting_approval" || r.stopCode === "needs_person",
      // a train leads to its run, and to the inbox when the run waits for a person
      href: `${r.stopCode === "awaiting_approval" || r.stopCode === "needs_person" ? "/inbox" : "/runs"}/${r.id}`,
    }));

export function Legend() {
  return (
    <div className="legend">
      <span>
        <i className="pass" />
        passes
      </span>
      <span>
        <i className="fail" />
        fails
      </span>
      <span>
        <i className="asks" />
        asks a person
      </span>
      <span>
        <i className="end" />
        ends the run
      </span>
      <span>
        <i className="work" />
        work is going on
      </span>
      <span>
        <i className="cond" />
        only on a condition
      </span>
      <span>
        <i className="capsule" />a person approves here
      </span>
      <span>
        <i className="bar" />a gate
      </span>
      <span>×2: goes back at most twice</span>
      <span className="keys">
        <kbd>←</kbd> <kbd>→</kbd> move, <kbd>Enter</kbd> open, <kbd>c</kbd> connect
      </span>
    </div>
  );
}

/** The three kinds of lane to add. Above phone width they stand behind one button until it is pressed; at phone width the Tools fold holds them. */
export function AddLane({ onAdd }: { onAdd: (kind: "agent" | "command" | "wait") => void }) {
  const [open, setOpen] = useState(false);
  const add = (kind: "agent" | "command" | "wait") => {
    setOpen(false);
    onAdd(kind);
  };
  return (
    <div className="group addlane" data-open={open}>
      <button
        type="button"
        className="button desk-only"
        aria-expanded={open}
        aria-controls="add-lane-kinds"
        onClick={() => setOpen(!open)}
      >
        Add a lane
      </button>
      <span className="label phone-only">Add a lane</span>
      <span className="kinds" id="add-lane-kinds">
        <button type="button" className="button" onClick={() => add("agent")}>
          Agent
        </button>
        <button type="button" className="button" onClick={() => add("command")}>
          Command
        </button>
        <button type="button" className="button" onClick={() => add("wait")}>
          Wait
        </button>
      </span>
    </div>
  );
}

/** The top bar's controls that fold behind one button at phone width; above it they stand in the row. */
export function Fold({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="button phone-only"
        aria-expanded={open}
        aria-controls="floor-tools"
        onClick={() => setOpen(!open)}
      >
        Tools
      </button>
      <div className="tools" id="floor-tools" data-open={open}>
        {children}
      </div>
    </>
  );
}

/** In the JSON view, put the caret on a lane's id and bring it into sight. */
export function caretToLane(area: HTMLTextAreaElement, text: string, id: string): void {
  const needle = `"id": ${JSON.stringify(id)}`;
  // from where the lanes begin: a collector or a panel member may have the same id earlier in the text
  const at = text.indexOf(needle, text.indexOf('"lanes"'));
  if (at < 0) return;
  area.focus();
  area.setSelectionRange(at, at + needle.length);
  // a text area does not scroll to its selection by itself
  area.scrollTop =
    (text.slice(0, at).split("\n").length - 3) * Number.parseFloat(getComputedStyle(area).lineHeight);
}
