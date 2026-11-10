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
  const count = countTests(head.output, pattern);

  // the base commit is measured once per run and remembered
  const key = `baseTests:${name}`;
  if (!Object.hasOwn(g.memo, key)) {
    const base = await runIn(g, await g.checkouts.at(g.base, "base"), command);
    saveEvidence(
      g.ws,
      g.runId,
      `${g.tag}-${g.gateId}.base.log`,
      `$ ${command}\n# on the base commit ${g.base}, exit ${base.exitCode}\n\n${base.output}`,
    );
    g.memo[key] = countTests(base.output, pattern) ?? null;
  }
  const base = g.memo[key] ?? null;

  let verdict: string;
  let passed = false;
  if (count === undefined) {
    verdict =
      'The gate could not read a test count from the output. If the runner is not one it knows, add "with": { "pattern": "<regular expression with one group>" }.';
  } else if (count === 0) {
    verdict = "No tests ran on this change.";
  } else if (base !== null && count < base) {
    verdict = `${plural(count)} ran on this change, fewer than on the base commit, which ran ${base}.`;
  } else {
    passed = true;
    verdict = `${plural(count)} ran on this change. The base commit ran ${base ?? "a number that could not be read"}.`;
  }
  return record(g, passed, `${verdict}\n\n$ ${command}\n# exit ${head.exitCode}\n\n${head.output}`, started, {
    command,
    exit_code: head.exitCode,
  });
}
