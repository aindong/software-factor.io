// What a person approves before a command lane runs: the command's description from the workflow
// and the run's branch. Only for an approval of work that has not been done (nothing to send back).
import type { Workflow } from "./schema/workflow.ts";
import { readWorkflow } from "./workflow-files.ts";

export interface Ahead {
  /** The lane that runs next. */
  lane: string;
  /** The workspace command's name; the lane's name when it runs shell text of its own (never shown). */
  command: string;
  /** The workflow's description of the command, or null when it has none. */
  description: string | null;
  branch: string;
}

export function aheadOf(
  workflow: Workflow | undefined,
  item: { lane: string; kind: string; decisions: string[] },
  branch: string,
): Ahead | undefined {
  if (item.kind === "question" || item.decisions.includes("send-back")) return undefined;
  const lane = workflow?.lanes.find((l) => l.id === item.lane);
  if (lane?.uses !== "core/command@1") return undefined;
  const named = typeof lane.with?.command === "string" ? lane.with.command : undefined;
  const description = named ? (workflow?.commands?.[named]?.description ?? null) : null;
  return { lane: lane.name ?? lane.id, command: named ?? lane.name ?? lane.id, description, branch };
}

/** The same, read from the workspace's own file of the run's workflow: nothing when it cannot be read. */
export function aheadFor(
  root: string,
  workflow: string,
  item: { lane: string; kind: string; decisions: string[] },
  branch: string,
): Ahead | undefined {
  try {
    const read = readWorkflow(root, workflow).workflow;
    return read && typeof read === "object" ? aheadOf(read as Workflow, item, branch) : undefined;
  } catch {
    return undefined; // no such workflow here any more: the bar says what it can without it
  }
}
