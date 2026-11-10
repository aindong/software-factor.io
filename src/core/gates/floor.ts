// core/test-floor@1: at least as many tests run on the change as on the base commit, and more than
// none. It catches a test suite that shrank or stopped running. It cannot tell a wrong test from a
// right one: that is what review is for.
import { saveEvidence } from "../evidence.ts";
import { resolveCommand, runIn } from "./command.ts";
import { countTests } from "./count.ts";
import { type GateJob, record } from "./types.ts";

const plural = (n: number) => `${n} test${n === 1 ? "" : "s"}`;

export async function testFloorGate(g: GateJob) {
  const started = Date.now();
  const name = typeof g.settings.command === "string" ? g.settings.command : "verify";
  const pattern = typeof g.settings.pattern === "string" ? g.settings.pattern : undefined;
  const command = resolveCommand(g.ws, { command: name }, `Gate "${g.gateId}"`);

  const head = await runIn(g, await g.checkouts.at(g.head, "head"), command);
  const count = head.timedOut ? undefined : countTests(head.output, pattern);

  // the base commit is measured once per run and remembered, unless the measurement itself failed
  const key = `baseTests:${name}:${pattern ?? ""}`;
  let base = Object.hasOwn(g.memo, key) ? (g.memo[key] ?? null) : undefined;
  if (base === undefined) {
    const run = await runIn(g, await g.checkouts.at(g.base, "base"), command);
    base = run.timedOut ? null : (countTests(run.output, pattern) ?? null);
    if (!Object.hasOwn(g.memo, `${key}:saved`)) {
      saveEvidence(
        g.ws,
        g.runId,
        `${g.tag}-${g.gateId}.base.log`,
        `$ ${command}\n# on the base commit ${g.base}, exit ${run.exitCode}\n\n${run.output}`,
      );
      g.memo[`${key}:saved`] = 1;
    }
    if (base !== null) g.memo[key] = base;
  }

  let verdict: string;
  let passed = false;
  if (head.timedOut) {
    verdict = "The suite timed out on this change, so no count could be read.";
  } else if (count === undefined) {
    verdict =
      'The gate could not read a test count from the output. If the runner is not one it knows, add "with": { "pattern": "<regular expression with one group of digits>" }.';
  } else if (count === 0) {
    verdict = "No tests ran on this change.";
  } else if (base === null) {
    verdict = `${plural(count)} ran on this change, but the base commit's count could not be read, so there is nothing to compare with.`;
  } else if (count < base) {
    verdict = `${plural(count)} ran on this change, fewer than on the base commit, which ran ${base}.`;
  } else {
    passed = true;
    verdict = `${plural(count)} ran on this change. The base commit ran ${base}.`;
  }
  // the suite's own exit code is not this gate's verdict, so it is not recorded as one
  return record(g, passed, `${verdict}\n\n$ ${command}\n# exit ${head.exitCode}\n\n${head.output}`, started, {
    command,
  });
}
