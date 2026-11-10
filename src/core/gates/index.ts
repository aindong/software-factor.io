// Which code runs for which gate type. Every gate gets the same job and returns the same record,
// so the engine treats them alike.
import type { GateRecord } from "../store.ts";
import { commandGate } from "./command.ts";
import { newTestsFailOnBaseGate } from "./fail-on-base.ts";
import { testFloorGate } from "./floor.ts";
import { protectedPathsGate } from "./paths.ts";
import type { GateJob } from "./types.ts";
import { testsNotWeakenedGate } from "./weakened.ts";

export const GATES: Record<string, (g: GateJob) => GateRecord | Promise<GateRecord>> = {
  "core/command@1": commandGate,
  "core/protected-paths@1": protectedPathsGate,
  "core/tests-not-weakened@1": testsNotWeakenedGate,
  "core/test-floor@1": testFloorGate,
  "core/new-tests-fail-on-base@1": newTestsFailOnBaseGate,
};

export const isBuiltGate = (uses: string) => Object.hasOwn(GATES, uses);

export async function runGate(g: GateJob): Promise<GateRecord> {
  const gate = Object.hasOwn(GATES, g.uses) ? GATES[g.uses] : undefined;
  if (!gate) throw new Error(`no gate is built for "${g.uses}"`);
  return gate(g);
}
