// What the first sentence of a run's page says, apart from the part that is in the status line.
import { QUEUED } from "../core/runs/sentence.ts";
import type { RunRow } from "./api.ts";
import { detail, standing } from "./words.ts";

/** The run's own sentence for its page: without what the status line already says about a task queued again. */
export function pageSays(row: RunRow): string {
  const says = detail(row).replace(` ${QUEUED}`, "");
  return says === `${standing(row).word}.` ? "" : says;
}
