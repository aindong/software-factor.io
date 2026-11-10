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
    ["./check.sh", "check.sh", true],
    ["/.github/", ".github/a.yml", true],
    ["**/secrets/", "a/secrets/k.pem", true],
    [".claude/", ".Claude/settings.json", true],
    ["CLAUDE.md", "claude.md", true],
    ["file?.txt", "file1.txt", false],
    ["file?.txt", "file?.txt", true],
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

  it.each([
    ["vitest, skipped tests left out", "      Tests  2 skipped | 39 passed (41)\n", 39],
    ["jest, skipped tests left out", "Tests:       2 skipped, 3 passed, 5 total\n", 3],
    ["two packages, two summaries", "      Tests  10 passed (10)\n\n      Tests  7 passed (7)\n", 17],
    ["node:test with skipped tests", "# tests 6\n# pass 4\n# fail 1\n# skipped 1\n", 5],
    [
      "coloured output",
      "\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m3 passed\u001b[39m\u001b[22m\u001b[90m (3)\u001b[39m\n",
      3,
    ],
  ])("counts only tests that ran: %s", (_name, output, count) => {
    expect(countTests(output)).toBe(count);
  });

  it("gives nothing for a pattern that captures no whole number, or is not a valid pattern", () => {
    expect(countTests("ran no checks", "ran (\\S+) checks")).toBeUndefined();
    expect(countTests("ran 4 checks", "ran (")).toBeUndefined();
    expect(countTests("ran 4 checks", "ran \\d+ checks")).toBeUndefined();
  });

  it("gives nothing when there is no count", () => {
    expect(countTests("all good\n")).toBeUndefined();
  });

  it("uses a pattern when one is given", () => {
    expect(countTests("ran 4 checks", "ran (\\d+) checks")).toBe(4);
  });
});
