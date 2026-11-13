// What approving an inbox item sets going, from the workflow's route for a pass: the lane that
// starts, or the end of the run. Nothing when it cannot be known (a condition decides, the route
// leads to a place that is not a lane or the end, or the workflow is not known here).
import type { Workflow } from "../core/schema/workflow.ts";

export function nextStop(
  workflow: Workflow | undefined,
  item: { lane: string; kind: string; decisions: string[] },
): string | undefined {
  if (item.kind === "question") return undefined;
  const find = (id: string) => workflow?.lanes.find((l) => l.id === id);
  const named = (id: string, asks = false) => `${find(id)?.name ?? id} ${asks ? "waits for you" : "starts"}`;
  const asksFirst = (id: string) => {
    const l = find(id);
    return l?.checkpoint === "in" && (l.uses !== "core/agent@1" || l.oneWay === true);
  };
  // work that was not done yet is approved before its lane: that lane is what starts
  if (!item.decisions.includes("send-back")) return find(item.lane) ? named(item.lane) : undefined;
  const lane = find(item.lane);
  const pass = lane?.on.pass;
  const step = typeof pass === "string" ? { to: pass, when: undefined } : pass?.[0];
  if (!step || step.when) return undefined;
  return step.to === "@done"
    ? "the run ends done"
    : find(step.to)
      ? named(step.to, asksFirst(step.to))
      : undefined;
}

/** The bar's words: the lane that starts or waits comes "next"; the end of the run does not. */
export const barWords = (next: string) =>
  `Approve: ${/ (starts|waits for you)$/.test(next) ? `${next} next` : next}.`;
