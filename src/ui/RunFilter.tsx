// The filter of the Runs list: All and a button for each state that has a run, with its count.
// The buttons are in the Tab order; Enter or Space chooses, and the chosen one says so.
import type { RunRow } from "../core/runs/view.ts";
import { choices } from "./filter.ts";
import "./filter.css";

export function RunFilter({
  runs,
  show,
  onShow,
}: {
  runs: RunRow[];
  show: string | undefined;
  onShow: (show: string | undefined) => void;
}) {
  return (
    <fieldset className="runfilter">
      <legend className="sr">Show</legend>
      {choices(runs, show).map((c) => (
        <button key={c.word} type="button" aria-pressed={c.show === show} onClick={() => onShow(c.show)}>
          {c.word} <span className="data">{c.n}</span>
        </button>
      ))}
    </fieldset>
  );
}
