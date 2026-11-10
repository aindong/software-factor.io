import { describe, expect, it } from "vitest";
import { countTests } from "../../src/core/gates/count.ts";
import { matches } from "../../src/core/gates/glob.ts";

describe("matching a path against a pattern", () => {
  it.each([
    [".github/", ".github/workflows/ci.yml", true],
    [".github/", "docs/.github/x", false],
    ["pnpm-lock.yaml", "pnpm-lock.yaml", true],
    ["**/Cargo.lock", "sub/dir/Cargo.lock", true],
    ["**/Cargo.lock", "Cargo.lock", true],
    ["secrets/**", "secrets/a/b.txt", true],
    ["secrets/**", "other/secrets/a", false],
    ["*.test.js", "math.test.js", true],
    ["*.test.js", "src/math.test.js", false],
    ["**/*.test.*", "src/deep/math.test.ts", true],
    ["src/*.ts", "src/a.ts", true],
    ["src/*.ts", "src/a/b.ts", false],
    ["check.sh", "scripts/check.sh", false],
  ])("%s against %s is %s", (pattern, path, expected) => {
    expect(matches(pattern, path)).toBe(expected);
  });
});

describe("reading how many tests ran", () => {
  it.each([
    ["vitest", " Test Files  3 passed (3)\n      Tests  41 passed (41)\n", 41],
    ["vitest with failures", "      Tests  2 failed | 39 passed (41)\n", 41],
    ["jest", "Tests:       1 failed, 12 passed, 13 total\n", 13],
    ["pytest", "===== 7 passed, 1 skipped in 0.12s =====\n", 7],
    ["pytest with failures", "===== 2 failed, 5 passed in 0.12s =====\n", 7],
    ["cargo", "test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured\n", 9],
    ["cargo, two crates", "test result: ok. 9 passed; 0 failed;\ntest result: ok. 3 passed; 1 failed;\n", 13],
    ["node:test", "# tests 6\n# pass 5\n# fail 1\n", 6],
    ["the fixture runner", "# pass 2\n# fail 0\n", 2],
    ["mocha", "  14 passing (20ms)\n  1 failing\n", 15],
    ["go", "--- PASS: TestA (0.00s)\n--- PASS: TestB (0.00s)\n--- FAIL: TestC (0.00s)\n", 3],
  ])("from %s", (_runner, output, count) => {
    expect(countTests(output)).toBe(count);
  });

  it("gives nothing when there is no count", () => {
    expect(countTests("all good\n")).toBeUndefined();
  });

  it("uses a pattern when one is given", () => {
    expect(countTests("ran 4 checks", "ran (\\d+) checks")).toBe(4);
  });
});
