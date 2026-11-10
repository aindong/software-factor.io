// Reads how many tests ran from a test runner's output: the tests that passed or failed, not the
// ones skipped, added up over every summary the output holds (a monorepo prints one per package).
// For a runner not listed here, the workflow gives a pattern with one capture group.
const sum = (output: string, re: RegExp): number | undefined => {
  let total: number | undefined;
  for (const m of output.matchAll(re)) total = (total ?? 0) + Number(m[1] ?? 0);
  return total;
};
const both = (a: number | undefined, b: number | undefined) =>
  a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
// biome-ignore lint/suspicious/noControlCharactersInRegex: colour codes are control sequences
const ANSI = /\u001b\[[0-9;]*m/g;

export function countTests(raw: string, pattern?: string): number | undefined {
  const output = raw.replace(ANSI, "");
  if (pattern) {
    let last: string | undefined;
    try {
      last = [...output.matchAll(new RegExp(pattern, "gm"))].at(-1)?.[1];
    } catch {
      return undefined; // not a valid pattern: the gate then says it could not read a count
    }
    return last !== undefined && /^\d+$/.test(last) ? Number(last) : undefined;
  }
  // vitest: "Tests  2 failed | 39 passed (41)". jest: "Tests: 1 failed, 12 passed, 13 total".
  const summaries = [...output.matchAll(/^\s*Tests:?\s+(.*)$/gm)].map((m) => m[1] ?? "");
  if (summaries.length > 0) {
    const ran = summaries.reduce((n, line) => n + (sum(line, /(\d+) (?:passed|failed)\b/g) ?? 0), 0);
    return ran;
  }
  const cargo = both(
    sum(output, /^test result: .*?(\d+) passed;/gm),
    sum(output, /^test result: .*? (\d+) failed;/gm),
  );
  if (cargo !== undefined) return cargo;
  const tap = sum(output, /^# (?:pass|fail) (\d+)/gm);
  if (tap !== undefined) return tap;
  const pytest = [...output.matchAll(/^=+ (.*) in [\d.]+s.*=+\s*$/gm)].map((m) => m[1] ?? "");
  if (pytest.length > 0)
    return pytest.reduce((n, line) => n + (sum(line, /(\d+) (?:passed|failed|errors?)\b/g) ?? 0), 0);
  const mocha = sum(output, /^\s*(\d+) (?:passing|failing)\b/gm);
  if (mocha !== undefined) return mocha;
  const go = [...output.matchAll(/^\s*--- (?:PASS|FAIL): /gm)].length;
  return go > 0 ? go : undefined;
}
