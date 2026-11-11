// How a run stands: its mark and its word, the same on a row of the list and at the head of its page.
import type { RunRow } from "../core/runs/view.ts";
import { standing } from "./words.ts";

export function State({ run }: { run: RunRow }) {
  const { mark, word } = standing(run);
  return (
    <span className="state">
      <span className={`mark ${mark}`} aria-hidden="true" />
      <b>{word}</b>
    </span>
  );
}
