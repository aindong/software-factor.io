// Refuse what this version cannot run honestly, before any task is claimed.
import { UserError } from "../errors.ts";
import { resolveCommand } from "../gates/command.ts";
import { headOf } from "../git.ts";
import type { CommandSettings, WaitSettings } from "../schema/builtins.ts";
import type { Workspace } from "../workspace.ts";

const SUPPORTED_LANES = ["core/agent@1", "core/command@1", "core/wait@1"];
const later = (what: string, task: number) =>
  new UserError(
    `${what} is not built yet.`,
    `It arrives with task ${task} of the plan. Until then, leave it out of the workflow.`,
  );

export function preflight(ws: Workspace): void {
  try {
    headOf(ws.root);
  } catch {
    throw new UserError(
      "This repository has no commit yet, so there is nothing to branch a run from.",
      "Make a first commit, then run again.",
    );
  }
  for (const lane of ws.workflow.lanes) {
    if (!SUPPORTED_LANES.includes(lane.uses))
      throw later(`The lane type "${lane.uses}" (lane "${lane.id}")`, 19);
    if (lane.panel) throw later(`A panel (lane "${lane.id}")`, 13);
    if (lane.agent && !Object.hasOwn(ws.local.roles, lane.agent.role)) {
      throw new UserError(
        `The role "${lane.agent.role}" (lane "${lane.id}") is not bound to an agent on this machine.`,
        `Add "${lane.agent.role}" under "roles" in .factor/local.json.`,
      );
    }
    if (lane.uses === "core/command@1")
      resolveCommand(ws, (lane.with ?? {}) as CommandSettings, `Lane "${lane.id}"`);
    const until = lane.uses === "core/wait@1" ? (lane.with as WaitSettings).until : undefined;
    if (until) resolveCommand(ws, until, `Lane "${lane.id}"`);
    for (const gateId of lane.gates ?? []) {
      const gate = ws.workflow.gates?.[gateId];
      if (!gate) continue;
      if (gate.uses !== "core/command@1") throw later(`The gate type "${gate.uses}" (gate "${gateId}")`, 7);
      resolveCommand(ws, (gate.with ?? {}) as CommandSettings, `Gate "${gateId}"`);
    }
  }
}
