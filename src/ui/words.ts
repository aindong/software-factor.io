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
  if (run.status !== "stopped") return { mark: "none", word: "Dropped" };
  // a person stopped it: that is not a failure, and the diamond means a failure only
  return { mark: run.stopCode === "stopped_by_person" ? "stopped" : "fail", word: "Stopped" };
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

/** "13 min", "2 h 10 min", "under a minute": a length of time as a person says it. */
export function howLong(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (ms < 60_000) return "under a minute";
  if (min < 60) return `${min} min`;
  const rest = min % 60;
  return rest ? `${Math.floor(min / 60)} h ${rest} min` : `${Math.floor(min / 60)} h`;
}

/**
 * What an agent said about its lane, as whole sentences. The store keeps the first 500 characters and
 * adds "..." where it cut: that last, unfinished sentence is dropped, so the text never ends mid-thought.
 * A text with no full sentence in it is kept as it is, with its cut shown as an ellipsis.
 */
export function finished(note: string): string {
  if (!note.endsWith("...")) return note;
  const whole = note.slice(0, -3);
  const ends = [...whole.matchAll(/[.!?](?=\s)/g)];
  const last = ends.at(-1);
  return last ? whole.slice(0, (last.index ?? 0) + 1) : `${whole.trimEnd()}…`;
}

/** The two plain lines a run's page opens with: what it is doing or how it ended, and whether it needs a person. */
export function lede(run: RunRow, lane: string): { says: string; needs: boolean; line: string } {
  const asks =
    run.status === "waiting" && (run.stopCode === "awaiting_approval" || run.stopCode === "needs_person");
  const says =
    run.status === "running"
      ? `At work in ${lane}.`
      : asks
        ? `${lane} is waiting for a decision.`
        : run.status === "waiting"
          ? "Waiting, and it will carry on by itself."
          : run.status === "done"
            ? "Finished: every lane passed."
            : run.status === "stopped"
              ? "Stopped before it finished."
              : "Dropped: it was set aside.";
  const line = asks
    ? "This needs you."
    : run.status === "stopped" || run.status === "dropped"
      ? "Nothing is running."
      : "Nothing is needed from you.";
  return { says, needs: asks, line };
}

/** The first sentences of a note (two at most, about 260 characters), and whether there is more of it. */
export function lead(note: string): { head: string; more: boolean } {
  const text = finished(note).trim();
  let head = "";
  let n = 0;
  for (const s of text.match(/.*?[.!?](?=\s|$)|.+$/gs) ?? []) {
    if (head && (head + s).length > 260) break;
    head += s;
    if (++n === 2) break;
  }
  head = head.trim();
  return { head, more: head.length < text.length };
}

/**
 * A panel's note holds each reviewer's verdict, joined with "; ": "correctness: fail. It loses rows.; skeptic: pass. Fine."
 * Null when the note is not made so.
 */
export function verdicts(note: string): { who: string; pass: boolean; said: string }[] | null {
  const parts = finished(note).split(/;\s+(?=[\w.-]+(?: \([^)]*\))?: (?:pass|fail)\b)/);
  const found = parts.map((p) => /^([\w.-]+(?: \([^)]*\))?): (pass|fail)\b\.?\s*(.*)$/s.exec(p));
  if (found.some((m) => !m)) return null;
  return found.map((m) => ({ who: m?.[1] ?? "", pass: m?.[2] === "pass", said: (m?.[3] ?? "").trim() }));
}
