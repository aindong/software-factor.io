// What a run remembers between steps. It is saved to SQLite after every step, so a run that waits
// for a person or for a clock continues from the record, in a later process, and not from memory.
import type { Outcome } from "../store.ts";

export interface Parked {
  /** approve-before: a command, wait or one-way lane that has not run. approve-after: an agent's finished work. */
  kind: "approve-before" | "approve-after" | "answer" | "wait";
  lane: string;
  laneRun?: number;
  note?: string;
  /** For a wait: when to look again, and when to give up and ask a person. Milliseconds on the factory clock. */
  nextCheck?: number;
  deadline?: number;
}

export interface RunState {
  /** The lane to enter next. */
  next: string | null;
  seq: number;
  parked?: Parked;
  /** A lane a person approved to run, consumed when it starts. */
  approved?: string;
  /** How often each bounded transition entry has been taken, by `<lane>.<outcome>[<index>]`. */
  rounds: Record<string, number>;
  /** The run's head commit when each bounded entry was last taken, to notice a round with no new work. */
  loopHeads: Record<string, string>;
  outputs: Record<string, Record<string, unknown>>;
  gates: Record<string, Record<string, "pass" | "fail">>;
  /** Reasons a lane is entered again, shown to its agent once. */
  notes: Record<string, string[]>;
  /** How many times each lane's agent has been started. */
  entries: Record<string, number>;
  spent: { ms: number; tokens: number; usd: number };
  /** Set when a person rejected the work, so the end of the run can say so. */
  rejected?: boolean;
}

/** Add a reason for a lane to see the next time it runs. */
export function addNote(state: RunState, lane: string, note: string): void {
  const notes = state.notes[lane] ?? [];
  notes.push(note);
  state.notes[lane] = notes;
}

export const newState = (first: string): RunState => ({
  next: first,
  seq: 1,
  rounds: {},
  loopHeads: {},
  outputs: {},
  gates: {},
  notes: {},
  entries: {},
  spent: { ms: 0, tokens: 0, usd: 0 },
});

export type StopCode =
  | "done"
  | "dropped"
  | "lane_failed"
  | "rejected"
  | "out_of_rounds"
  | "no_progress"
  | "budget_minutes"
  | "budget_tokens"
  | "budget_usd"
  | "gate_stop"
  | "git_config_changed"
  | "interrupted"
  | "crashed"
  | "awaiting_approval"
  | "needs_person"
  | "waiting";

export interface LaneResult {
  outcome: Outcome;
  note: string;
  /** Set when the lane ends the whole run, whatever its transitions say. */
  stop?: { code: StopCode; reason: string };
}
