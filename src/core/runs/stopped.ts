// A lane that a person stopped did not fail: the stop wrote its outcome as a failure, in its own words.

/** The visit a person stopped: the run's last, when the run was stopped by a person and the visit ended in that stop. */
export function stoppedVisit(
  stopCode: string | null,
  visits: { id: number; outcome: string | null; note: string | null }[],
): number | undefined {
  const last = visits.at(-1);
  return stopCode === "stopped_by_person" &&
    last?.outcome === "fail" &&
    last.note?.startsWith("stopped by a person")
    ? last.id
    : undefined;
}
