// The list of runs, kept up to date by the server. One connection for the whole page, shared by
// every screen that shows runs and by the rail's count, and open only while one of them is shown.
import { useSyncExternalStore } from "react";
import { hasKey, listen, type Queued, type RunRow } from "./api.ts";

interface Live {
  runs: RunRow[] | undefined;
  /** The tasks waiting for a run, oldest first. */
  queued: Queued[];
  live: boolean;
}
let now: Live = { runs: undefined, queued: [], live: true };
const listeners = new Set<() => void>();
let stop: (() => void) | undefined;
const set = (change: Partial<Live>) => {
  now = { ...now, ...change };
  for (const tell of listeners) tell();
};
function subscribe(tell: () => void): () => void {
  listeners.add(tell);
  // a page with no key is refused, and a refusal loads the page again: it would never end
  if (hasKey)
    stop ??= listen(
      (runs, queued) => set({ runs, queued }),
      (live) => set({ live }),
    );
  return () => {
    listeners.delete(tell);
    if (listeners.size === 0) {
      stop?.();
      stop = undefined;
    }
  };
}

export const useRuns = (): Live => useSyncExternalStore(subscribe, () => now);
