// The words and numbers of a run, written the same way wherever they show.
import type { RunRow } from "../core/runs/view.ts";

/** How a run stands, as the shape and the word of its row. */
export function standing(run: RunRow): { mark: string; word: string } {
  if (run.status === "running") return { mark: "working", word: "Working" };
  if (run.status === "waiting") {
    return run.stopCode === "awaiting_approval" || run.stopCode === "needs_person"
      ? { mark: "asked", word: "Waits for you" }
      : { mark: "moving", word: "Waits by itself" };
  }
  if (run.status === "done") return { mark: "pass", word: "Done" };
  return run.status === "stopped" ? { mark: "fail", word: "Stopped" } : { mark: "none", word: "Dropped" };
}

/** A run's sentence, unless it only repeats the state that stands beside it ("Done."). */
export const detail = (run: RunRow): string =>
  run.sentence === `${standing(run).word}.` ? "" : run.sentence;

const whole = new Intl.NumberFormat("en-US");
/** "1,200 tokens". */
export const tokens = (n: number) => `${whole.format(n)} ${n === 1 ? "token" : "tokens"}`;
const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
/** "$2.59": cents, and two significant digits only for an amount under one cent ("$0.0042"). The exact figure is in `softwarefactor cost --json`. */
export const dollars = (usd: number) =>
  usd > 0 && usd < 0.01 ? `$${Math.max(usd, 0.000001).toPrecision(2)}` : cents.format(usd);
/** "$0.25", and "at least $0.25" when a part of the cost is not known. */
export const cost = (usd: number, unknown: boolean) =>
  unknown ? (usd > 0 ? `at least ${dollars(usd)}` : "cost not known") : dollars(usd);
/** "45s", "3m 05s", "2h 10m". */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}
/** When something happened, against now: "just now", "5 min ago", "3 h ago", or the day. */
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (Number.isNaN(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** A sentence whose `backticked` words are code: its parts, in order, each marked as code or not. */
export const coded = (sentence: string): { text: string; code: boolean }[] =>
  sentence
    .split("`")
    .map((text, i) => ({ text, code: i % 2 === 1 }))
    .filter((part) => part.text !== "");
