// The filter of the Runs list: a run's state, as the address writes it (`/runs?show=working`).
// The words are standing()'s own, so the list and the page of a run never say two things.
import type { RunRow } from "../core/runs/view.ts";
import { standing } from "./words.ts";

/** The states in the order a person cares: what moves, what needs them, then what ended. */
const ORDER = ["working", "waits-for-you", "waits-by-itself", "done", "stopped", "dropped"];
const slug = (run: RunRow) => standing(run).word.toLowerCase().replaceAll(" ", "-");

export type Choice = { show: string | undefined; word: string; n: number };

/** Whether the filter lets a run through. */
export const kept = (run: RunRow, show: string | undefined): boolean =>
  show === undefined || slug(run) === show;
export const shownRuns = (runs: RunRow[], show: string | undefined): RunRow[] =>
  runs.filter((r) => kept(r, show));

/** All, and each state that has a run, with its count. The state that is chosen stays, even at none. */
export function choices(runs: RunRow[], show: string | undefined): Choice[] {
  const states = ORDER.filter((s) => s === show || runs.some((r) => slug(r) === s));
  const word = (s: string) => {
    const run = runs.find((r) => slug(r) === s);
    return run ? standing(run).word : s.replaceAll("-", " ").replace(/^./, (c) => c.toUpperCase());
  };
  return [
    { show: undefined, word: "All", n: runs.length },
    ...states.map((s) => ({
      show: s,
      word: word(s),
      n: runs.filter((r) => slug(r) === s).length,
    })),
  ];
}

/** What the list says when the filter leaves nothing. */
export function emptyWords(show: string): string {
  const state = show.replaceAll("-", " ");
  return state.startsWith("waits") ? `No run ${state}.` : `No run is ${state}.`;
}

/** The state the address asks for. A word that is no state is no filter. */
export function readShow(search: string): string | undefined {
  const show = new URLSearchParams(search).get("show") ?? "";
  return ORDER.includes(show) ? show : undefined;
}
/** The address with the filter in it; All writes nothing. */
export const withShow = (path: string, show: string | undefined): string =>
  show ? `${path}?show=${show}` : path;
