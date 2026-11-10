// core/new-tests-fail-on-base@1: the tests a change adds must fail without the change. The new and
// grown test files are put on a fresh checkout of the base commit and the suite is run there. If
// it passes, those tests do not test the change.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveCommand, runIn } from "./command.ts";
import { countDeclarations, DEFAULT_TEST_GLOBS, isTestFile } from "./testfiles.ts";
import { changedFiles, fileAt, type GateJob, record } from "./types.ts";

export async function newTestsFailOnBaseGate(g: GateJob) {
  const started = Date.now();
  const globs = (g.settings.testGlobs as string[] | undefined) ?? DEFAULT_TEST_GLOBS;
  const name = typeof g.settings.command === "string" ? g.settings.command : "verify";
  const changed = changedFiles(g).filter((f) => f.status !== "D");
  const tests = changed.filter((f) => isTestFile(f.path, globs));
  const fresh = tests.filter(
    (f) =>
      f.status === "A" ||
      countDeclarations(fileAt(g, g.head, f.path) ?? "") > countDeclarations(fileAt(g, g.base, f.path) ?? ""),
  );
  if (fresh.length === 0)
    return record(g, true, "The change has no new tests, so there is nothing to check.\n", started);
  if (tests.length === changed.length) {
    return record(g, true, "Only tests changed, so there is no change for them to fail without.\n", started);
  }

  const command = resolveCommand(g.ws, { command: name }, `Gate "${g.gateId}"`);
  const checkout = await g.checkouts.at(g.base, "base-with-new-tests");
  for (const f of fresh) {
    const target = join(checkout, f.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, fileAt(g, g.head, f.path) ?? "");
  }
  const result = await runIn(g, checkout, command);
  const list = fresh.map((f) => `  ${f.path}`).join("\n");
  const passed = result.exitCode !== 0 && !result.timedOut;
  const verdict = result.timedOut
    ? "The suite timed out on the base commit, so the check could not be made."
    : passed
      ? "The new tests fail on the base commit, as they should: they test the change."
      : "The new tests pass without the change, so they do not test it.";
  const text = `${verdict}\n\nNew or grown test files, put on the base commit ${g.base}:\n${list}\n\n$ ${command}\n# exit ${result.exitCode}\n\n${result.output}`;
  return record(g, passed, text, started, { command, exit_code: result.exitCode });
}
