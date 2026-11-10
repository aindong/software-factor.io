// core/tests-not-weakened@1: no test was deleted, removed, skipped, or had an assertion changed
// without a test being added, and the project's test script is as it was. An agent that cannot make
// a test pass must not be able to make it go away.
import { git } from "../git.ts";
import { countDeclarations, countSkips, DEFAULT_TEST_GLOBS, isAssertion, isTestFile } from "./testfiles.ts";
import { changedFiles, fileAt, type GateJob, record } from "./types.ts";

const CHECK_SCRIPTS = ["test", "lint", "typecheck", "verify", "check"];

function scriptsOf(text: string | undefined): Record<string, string> {
  try {
    const scripts = JSON.parse(text ?? "{}").scripts;
    return typeof scripts === "object" && scripts !== null ? scripts : {};
  } catch {
    return {};
  }
}

export function testsNotWeakenedGate(g: GateJob) {
  const started = Date.now();
  const globs = (g.settings.testGlobs as string[] | undefined) ?? DEFAULT_TEST_GLOBS;
  const findings: string[] = [];

  for (const { status, path } of changedFiles(g)) {
    if (path === "package.json" || path.endsWith("/package.json")) {
      const [before, after] = [scriptsOf(fileAt(g, g.base, path)), scriptsOf(fileAt(g, g.head, path))];
      for (const name of CHECK_SCRIPTS) {
        if (before[name] !== undefined && before[name] !== after[name]) {
          findings.push(
            `${path}: the test script changed ("${name}": ${JSON.stringify(before[name])} became ${JSON.stringify(after[name])})`,
          );
        }
      }
    }
    if (!isTestFile(path, globs)) continue;
    const before = fileAt(g, g.base, path) ?? "";
    const baseTests = countDeclarations(before);
    if (status === "D") {
      if (baseTests > 0)
        findings.push(`${path}: deleted, with its ${baseTests} test${baseTests === 1 ? "" : "s"}`);
      continue;
    }
    if (status !== "M") continue;
    const after = fileAt(g, g.head, path) ?? "";
    const headTests = countDeclarations(after);
    if (headTests < baseTests) findings.push(`${path}: fewer tests (${baseTests} became ${headTests})`);
    if (countSkips(after) > countSkips(before))
      findings.push(`${path}: more tests are marked skip, todo or only`);
    const removed = git(g.ws.root, "diff", "-U0", g.base, g.head, "--", path)
      .split("\n")
      .filter((l) => l.startsWith("-") && !l.startsWith("---") && isAssertion(l));
    if (removed.length > 0 && headTests <= baseTests) {
      findings.push(
        `${path}: an assertion in an existing test changed or was removed, and no test was added:\n${removed.map((l) => `    ${l}`).join("\n")}`,
      );
    }
  }
  const text =
    findings.length > 0
      ? `Tests were weakened:\n\n${findings.join("\n")}\n`
      : "No test was deleted, removed, skipped or weakened.\n";
  return record(g, findings.length === 0, text, started);
}
