// Which code runs for which gate type. Every gate gets the same job and returns the same record,
// so the engine treats them alike.

import { pluginType } from "../plugins/use.ts";
import type { GateRecord } from "../store.ts";
import { commandGate } from "./command.ts";
import { newTestsFailOnBaseGate } from "./fail-on-base.ts";
import { testFloorGate } from "./floor.ts";
import { protectedPathsGate } from "./paths.ts";
import { noSecretsGate } from "./secrets.ts";
import type { GateJob } from "./types.ts";
import { testsNotWeakenedGate } from "./weakened.ts";

export const GATES: Record<string, (g: GateJob) => GateRecord | Promise<GateRecord>> = {
  "core/command@1": commandGate,
  "core/protected-paths@1": protectedPathsGate,
  "core/tests-not-weakened@1": testsNotWeakenedGate,
  "core/test-floor@1": testFloorGate,
  "core/new-tests-fail-on-base@1": newTestsFailOnBaseGate,
  "core/no-secrets@1": noSecretsGate,
};

export const isBuiltGate = (uses: string) => Object.hasOwn(GATES, uses);

export async function runGate(g: GateJob): Promise<GateRecord> {
  const gate = Object.hasOwn(GATES, g.uses) ? GATES[g.uses] : undefined;
  if (gate) return gate(g);
  if (g.uses.startsWith("core/")) throw new Error(`no gate is built for "${g.uses}"`);
  // A plugin's gate is its command, run as a command gate is: in a fresh checkout of the lane's
  // commit. The checkout is made first, so that the plugin's files are hashed as late as can be
  // before its command starts. (A program with the person's rights can still change a file in
  // that last moment: only an agent in an OS sandbox cannot. See docs/plugins.md.)
  await g.checkouts.at(g.head, "head");
  const plugin = pluginType(g.ws, "gate", g.uses, g.settings);
  const timeoutMinutes = g.settings.timeoutMinutes;
  return commandGate({
    ...g,
    settings: { run: plugin.run, timeoutMinutes },
    // a gate about "the change" needs to know where the run began
    env: { ...g.env, ...plugin.env, FACTOR_BASE: g.base, FACTOR_HEAD: g.head },
  });
}
