// The words of the floor's status line. A notice (a save that worked, a save that was refused,
// something an edit replaced) is shown until the next change, also while the workflow is not saved.
export interface FloorState {
  /** Why the JSON text does not parse, when it does not. */
  broken: string | undefined;
  problems: number;
  dirty: boolean;
  notice: { text: string; bad: boolean } | undefined;
  /** When this copy was saved, if it was saved here: a file read as it is carries no time. */
  savedAt?: string;
}

export function statusOf(state: FloorState): { text: string; bad: boolean; since?: string } {
  if (state.broken) return { text: "The JSON does not parse", bad: true };
  if (state.problems > 0)
    return { text: `${state.problems} ${state.problems === 1 ? "problem" : "problems"}`, bad: true };
  if (state.notice) return state.notice;
  if (state.dirty) return { text: "Not saved", bad: false };
  return state.savedAt ? { text: "Saved", bad: false, since: state.savedAt } : { text: "Saved", bad: false };
}
