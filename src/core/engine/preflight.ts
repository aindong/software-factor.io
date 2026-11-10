// Refuse what this version cannot run honestly, before any task is claimed.
import { existsSync } from "node:fs";
import { accountOf, rolesOf } from "../agents/index.ts";
import { UserError } from "../errors.ts";
import { resolveCommand } from "../gates/command.ts";
import { isBuiltGate } from "../gates/index.ts";
import { headOf } from "../git.ts";
import { readPrices } from "../prices.ts";
import type { CommandSettings, WaitSettings } from "../schema/builtins.ts";
import type { Workspace } from "../workspace.ts";

const SUPPORTED_LANES = ["core/agent@1", "core/command@1", "core/wait@1"];
const later = (what: string, task: number) =>
  new UserError(
    `${what} is not built yet.`,
    `It arrives with task ${task} of the plan. Until then, leave it out of the workflow.`,
  );

export function preflight(ws: Workspace): void {
  readPrices(); // a price file that cannot be read is refused now, not in the middle of a run
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
    for (const role of rolesOf(lane)) {
      if (!Object.hasOwn(ws.local.roles, role)) {
        throw new UserError(
          `The role "${role}" (lane "${lane.id}") is not bound to an agent on this machine.`,
          `Bind it with \`softwarefactor role bind ${role} --account <name>\`.`,
        );
      }
      const binding = ws.local.roles[role];
      const bound = binding ? accountOf(binding, role) : undefined;
      if (bound?.account.profile && !existsSync(bound.account.profile)) {
        throw new UserError(
          `The profile folder of the account "${bound.name}" does not exist: ${bound.account.profile}`,
          "Sign in with that CLI again, or remove the account and add it with the right folder.",
        );
      }
    }
    if (lane.uses === "core/command@1")
      resolveCommand(ws, (lane.with ?? {}) as CommandSettings, `Lane "${lane.id}"`);
    const until = lane.uses === "core/wait@1" ? (lane.with as WaitSettings).until : undefined;
    if (until) resolveCommand(ws, until, `Lane "${lane.id}"`);
    for (const gateId of lane.gates ?? []) {
      const gate = ws.workflow.gates?.[gateId];
      if (!gate) continue;
      if (gate.uses.startsWith("core/") && !isBuiltGate(gate.uses))
        throw later(`The gate type "${gate.uses}" (gate "${gateId}")`, 19);
      const settings = (gate.with ?? {}) as CommandSettings;
      // a floor or a fail-on-base gate runs the workspace's verify command unless it names another
      const runsVerify = gate.uses === "core/test-floor@1" || gate.uses === "core/new-tests-fail-on-base@1";
      if (gate.uses === "core/command@1") resolveCommand(ws, settings, `Gate "${gateId}"`);
      else if (runsVerify) resolveCommand(ws, { command: settings.command ?? "verify" }, `Gate "${gateId}"`);
    }
  }
}
