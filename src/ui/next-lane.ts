// What approving an inbox item sets going, from the workflow's route for a pass: the lane that
// starts, or the end of the run. Nothing when it cannot be known (a condition decides, the route
// leads to a place that is not a lane or the end, or the workflow is not known here). And what
// rejecting or sending it back does, from the same workflow.
import type { Workflow } from "../core/schema/workflow.ts";

type Asked = { lane: string; kind: string; decisions: string[] };
type Step = { to: string; when?: unknown };

/** Where a route's first step leads, when no condition decides it. */
function firstStep(route: unknown): string | undefined {
  const step: Step | undefined =
    typeof route === "string" ? { to: route } : (route as Step[] | undefined)?.[0];
  return step && !step.when ? step.to : undefined;
}

/** What a route to a lane or to the end of the run comes to, in words; nothing when it cannot be said. */
function stopOf(workflow: Workflow | undefined, to: string | undefined): string | undefined {
  if (to === "@done") return "the run ends done";
  const lane = to ? workflow?.lanes.find((l) => l.id === to) : undefined;
  if (!lane) return undefined;
  const asks = lane.checkpoint === "in" && (lane.uses !== "core/agent@1" || lane.oneWay === true);
  return `${lane.name ?? lane.id} ${asks ? "waits for you" : "starts"}`;
}

export function nextStop(workflow: Workflow | undefined, item: Asked): string | undefined {
  if (item.kind === "question") return undefined;
  const lane = workflow?.lanes.find((l) => l.id === item.lane);
  // work that was not done yet is approved before its lane: that lane is what starts
  if (!item.decisions.includes("send-back")) return lane ? `${lane.name ?? lane.id} starts` : undefined;
  return stopOf(workflow, firstStep(lane?.on.pass));
}

/** What Reject and Send back do, said before they are pressed: the lane's fail route, and the lane again with the note. */
export function consequenceWords(workflow: Workflow | undefined, item: Asked): string | undefined {
  if (item.kind === "question") return undefined;
  const lane = workflow?.lanes.find((l) => l.id === item.lane);
  const to = firstStep(lane?.on.fail);
  const reject =
    to === "@stop"
      ? "the run stops"
      : to === "@drop"
        ? "the run is dropped"
        : to === "@inbox"
          ? "it waits for you again"
          : (stopOf(workflow, to) ?? "the lane's fail route decides");
  const back = item.decisions.includes("send-back")
    ? ` Send back: ${lane?.name ?? lane?.id ?? "the lane"} runs again with your note.`
    : "";
  return `Reject: ${reject}.${back}`;
}

/** The bar's words: the lane that starts or waits comes "next"; the end of the run does not. */
export const barWords = (next: string) =>
  `Approve: ${/ (starts|waits for you)$/.test(next) ? `${next} next` : next}.`;
