// The files a run changed, read once its evidence is open: a reference to a file opens the run's diff only
// when that diff has the file in it, and one to a commit only when the run changed something.
import { useEffect, useState } from "react";
import { getDiff } from "./api.ts";

/** The paths in the run's diff (name-status lines: "M\tsrc/a.ts", "R100\told\tnew"). Nothing until it is read. */
export function useChanged(runId: string, stamp: string, on: boolean): string[] | undefined {
  const [changed, setChanged] = useState<string[]>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the stamp changes when the run does
  useEffect(() => {
    if (!on) return;
    let left = false;
    getDiff(runId).then(({ body }) => {
      if (!left) setChanged((body.changed ?? []).flatMap((line) => line.split("\t").slice(1)));
    });
    return () => {
      left = true;
    };
  }, [runId, stamp, on]);
  return changed;
}

/** Where a claim's reference leads: the diff, for a commit or a file in it. A file or picture the run attached has its own path. */
export function opensDiff(ref: string, ok: boolean, changed: string[] | undefined): boolean {
  if (!ok || !changed) return false;
  if (ref.startsWith("commit:")) return changed.length > 0;
  return ref.startsWith("file:") && changed.includes(ref.slice(5));
}
