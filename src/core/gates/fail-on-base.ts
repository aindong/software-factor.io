// core/new-tests-fail-on-base@1: the tests a change adds must fail without the change. The new and
// grown test files are put on a fresh checkout of the base commit and the suite is run there. If
// it passes, those tests do not test the change. A new test that fails on the base commit only
// because it cannot load a new file still counts as failing: the gate cannot tell why a test fails.
import { git } from "../git.ts";
import { resolveCommand, runIn } from "./command.ts";
import { countDeclarations, DEFAULT_TEST_GLOBS, isTestByName, isTestFile } from "./testfiles.ts";
import { changedFiles, fileAt, type GateJob, record } from "./types.ts";

export async function newTestsFailOnBaseGate(g: GateJob) {
  const started = Date.now();
  const globs = (g.settings.testGlobs as string[] | undefined) ?? DEFAULT_TEST_GLOBS;
  const name = typeof g.settings.command === "string" ? g.settings.command : "verify";
  const all = changedFiles(g);
  const deletedBlobs = new Set(all.filter((f) => f.status === "D").map((f) => f.oldBlob));
  const changed = all.filter((f) => f.status !== "D");
  const tests = changed.filter((f) => isTestFile(f.path, globs));
  const fresh = tests.filter((f) => {
    const now = countDeclarations(fileAt(g, g.head, f.path) ?? "");
    // an added file is a new test unless it is a renamed one, or a fixture in a test folder
    if (f.status === "A") return !deletedBlobs.has(f.newBlob) && (isTestByName(f.path) || now > 0);
    return now > countDeclarations(fileAt(g, g.base, f.path) ?? "");
  });
  if (fresh.length === 0)
    return record(g, true, "The change has no new tests, so there is nothing to check.\n", started);
  if (tests.length === changed.length) {
    return record(g, true, "Only tests changed, so there is no change for them to fail without.\n", started);
  }

  const command = resolveCommand(g.ws, { command: name }, `Gate "${g.gateId}"`);
  // the base commit must pass on its own first, or a failure with the new tests means nothing
  const key = `baseGreen:${name}`;
  if (!Object.hasOwn(g.memo, key)) {
    const plain = await runIn(g, await g.checkouts.at(g.base, "base"), command);
    g.memo[key] = plain.exitCode === 0 ? 1 : 0;
  }
  if (g.memo[key] !== 1) {
    return record(
      g,
      false,
      `The suite already fails on the base commit ${g.base}, before any new test is added, so this gate cannot tell whether the new tests test the change. Fix the base first.\n`,
      started,
      { command },
    );
  }

  const checkout = await g.checkouts.at(g.base, "base-with-new-tests");
  // git puts the files there itself: modes and binary content are kept, and nothing is written through a link
  git(checkout, "checkout", g.head, "--", ...fresh.map((f) => f.path));
  const result = await runIn(g, checkout, command);
  const list = fresh.map((f) => `  ${f.path}`).join("\n");
  const passed = result.exitCode !== 0 && !result.timedOut;
  const verdict = result.timedOut
    ? "The suite timed out on the base commit, so the check could not be made."
    : passed
      ? "The new tests fail on the base commit, as they should: they test the change."
      : "The new tests pass without the change, so they do not test it.";
  const text = `${verdict}\n\nNew or grown test files, put on the base commit ${g.base}:\n${list}\n\n$ ${command}\n# exit ${result.exitCode} on the base commit with the new tests\n\n${result.output}`;
  return record(g, passed, text, started, { command });
}
