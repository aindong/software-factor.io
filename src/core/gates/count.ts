// Reads how many tests ran from a test runner's output. Each known runner prints a total somewhere.
// For a runner not listed here, the workflow gives a pattern with one capture group.
const sum = (output: string, re: RegExp, groups: number[]): number | undefined => {
  let total: number | undefined;
  for (const m of output.matchAll(re))
    total = (total ?? 0) + groups.reduce((n, g) => n + Number(m[g] ?? 0), 0);
  return total;
};

export function countTests(output: string, pattern?: string): number | undefined {
  if (pattern) {
    const all = [...output.matchAll(new RegExp(pattern, "gm"))];
    const last = all.at(-1)?.[1];
    return last === undefined ? undefined : Number(last);
  }
  const vitest = /^\s*Tests\s+.*\((\d+)\)\s*$/m.exec(output);
  if (vitest) return Number(vitest[1]);
  const jest = /^Tests:\s.*?(\d+) total/m.exec(output);
  if (jest) return Number(jest[1]);
  const cargo = sum(output, /^test result: .*?(\d+) passed; (\d+) failed/gm, [1, 2]);
  if (cargo !== undefined) return cargo;
  const tap = /^# tests (\d+)/m.exec(output);
  if (tap) return Number(tap[1]);
  const tapParts = sum(output, /^# (?:pass|fail) (\d+)/gm, [1]);
  if (tapParts !== undefined) return tapParts;
  const pytest = /^=+ (.*) in [\d.]+s.*=+\s*$/m.exec(output);
  if (pytest) return sum(pytest[1] ?? "", /(\d+) (?:passed|failed|errors?)\b/g, [1]);
  const mocha = sum(output, /^\s*(\d+) (?:passing|failing)\b/gm, [1]);
  if (mocha !== undefined) return mocha;
  const go = [...output.matchAll(/^\s*--- (?:PASS|FAIL): /gm)].length;
  return go > 0 ? go : undefined;
}
