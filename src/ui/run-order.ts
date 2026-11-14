// The order of the Runs list: what waits for a person, then what works, then what stopped, then what is
// done; the newest first inside each. The terminal's `softwarefactor runs` keeps the record's own order.
import type { RunRow } from "../core/runs/view.ts";
import { standing } from "./words.ts";

const GROUP: Record<string, number> = { asked: 0, working: 1, moving: 1, fail: 2, stopped: 2, pass: 3 };

export const inOrder = (runs: RunRow[]): RunRow[] =>
  runs
    .map((run, at) => ({ run, at, group: GROUP[standing(run).mark] ?? 4 }))
    .sort(
      (a, b) => a.group - b.group || Date.parse(b.run.startedAt) - Date.parse(a.run.startedAt) || a.at - b.at,
    )
    .map((x) => x.run);
