// The two figures the cost command prints under its tables, in the page's words: the cache hit
// rate, and what a landed task cost. Both come from the report the command prints.
import type { CostReport } from "../core/cost.ts";
import { dollars } from "./words.ts";

export function figures(
  report: Pick<CostReport, "cacheRate"> & {
    landed: Pick<CostReport["landed"], "tasks" | "ended" | "perTask">;
  },
) {
  const { cacheRate, landed } = report;
  const tasks = (n: number) => `${n} ended task${n === 1 ? "" : "s"}`;
  return {
    cache: cacheRate === null ? "none yet" : `${cacheRate}%`,
    cacheNote:
      cacheRate === null ? "No session could read from a cache." : "of what went in was read from a cache",
    perTask:
      landed.tasks === 0 ? "none yet" : landed.perTask === null ? "not known" : dollars(landed.perTask),
    perTaskNote:
      landed.tasks === 0
        ? "No task has landed yet."
        : `${landed.tasks} of ${tasks(landed.ended)} landed, every run of them counted`,
  };
}
