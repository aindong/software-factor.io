// core/tests-not-weakened@1: no test was deleted, removed, skipped or commented out, no assertion
// in an existing test was changed or removed, and the project's scripts are as they were. An agent
// that cannot make a test pass must not be able to make it go away. A person can still change a
// test: the gate hands that decision to them.
import { git } from "../git.ts";
import {
  countDeclarations,
  countSkips,
  DEFAULT_TEST_GLOBS,
  isAssertion,
  isTestByName,
  isTestFile,
} from "./testfiles.ts";
import { changedFiles, fileAt, type GateJob, record } from "./types.ts";

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
  const changed = changedFiles(g);
  // a deleted file whose exact content was added elsewhere was renamed, not removed
  const addedBlobs = new Set(changed.filter((f) => f.status === "A").map((f) => f.newBlob));

  for (const f of changed) {
    const { status, path } = f;
    if (path === "package.json" || path.endsWith("/package.json")) {
      const [before, after] = [scriptsOf(fileAt(g, g.base, path)), scriptsOf(fileAt(g, g.head, path))];
      for (const [name, was] of Object.entries(before)) {
        if (after[name] !== was) {
          findings.push(
            `${path}: the script "${name}" changed (${JSON.stringify(was)} became ${JSON.stringify(after[name] ?? null)}). The project's checks may run through it.`,
          );
        }
      }
    }
    if (status === "A" || !isTestFile(path, globs)) continue;
    const before = fileAt(g, g.base, path) ?? "";
    const baseTests = countDeclarations(before);
    if (status === "D") {
      if (addedBlobs.has(f.oldBlob)) continue;
      if (baseTests > 0)
        findings.push(`${path}: deleted, with its ${baseTests} test${baseTests === 1 ? "" : "s"}`);
      else if (isTestByName(path)) findings.push(`${path}: a test file was deleted`);
      continue;
    }
    // changed in place, or changed type (a file replaced by a link to something else)
    const after = fileAt(g, g.head, path) ?? "";
    const headTests = countDeclarations(after);
    if (headTests < baseTests) findings.push(`${path}: fewer tests (${baseTests} became ${headTests})`);
    if (countSkips(after) > countSkips(before))
      findings.push(`${path}: more tests are marked skip, todo or only`);
    const diff = git(g.ws.root, "diff", "-U0", g.base, g.head, "--", path).split("\n");
    const addedLines = new Set(
      diff.filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1).trim()),
    );
    // a line that comes back unchanged apart from its indentation was moved, not weakened
    const removed = diff.filter(
      (l) =>
        l.startsWith("-") &&
        !l.startsWith("---") &&
        isAssertion(l.slice(1)) &&
        !addedLines.has(l.slice(1).trim()),
    );
    if (removed.length > 0) {
      findings.push(
        `${path}: an assertion in an existing test changed or was removed:\n${removed.map((l) => `    ${l}`).join("\n")}`,
      );
    }
  }
  const text =
    findings.length > 0
      ? `Tests were weakened:\n\n${findings.join("\n")}\n`
      : "No test was deleted, removed, skipped or weakened.\n";
  return record(g, findings.length === 0, text, started);
}
