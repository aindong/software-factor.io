// What counts as a test file, a test, a skipped test and an assertion, across the common languages.
// These are pattern counts, not parsers: enough to notice a test that went missing.
import { matchesAny } from "./glob.ts";

export const DEFAULT_TEST_GLOBS = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/test_*.py",
  "**/*_test.py",
  "**/*_test.go",
  "**/__tests__/**",
  "test/**",
  "tests/**",
  "**/tests/**",
];

export const isTestFile = (path: string, globs: string[] = DEFAULT_TEST_GLOBS) => matchesAny(globs, path);

const DECLARATION =
  /(^|[^.\w])(it|test)(\.each\b[^(]*\([^)]*\))?\s*\(|^\s*def test_\w+|^func Test\w+|#\[(tokio::)?test\]/gm;
const SKIP =
  /\b(it|test|describe)\.(skip|todo|only)\b|\b(xit|xtest|xdescribe)\s*\(|@pytest\.mark\.(skip|xfail)|\bt\.Skip\(|#\[ignore\]/g;
const ASSERTION = /\bexpect\s*\(|\bassert\w*\b|\.should\b/;

export const countDeclarations = (text: string) => [...text.matchAll(DECLARATION)].length;
export const countSkips = (text: string) => [...text.matchAll(SKIP)].length;
export const isAssertion = (line: string) => ASSERTION.test(line);
