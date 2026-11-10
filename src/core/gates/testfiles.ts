// What counts as a test file, a test, a skipped test and an assertion, across the common languages.
// These are pattern counts over the text with comments removed, not parsers: enough to notice a
// test that went missing. They cannot see a test switched off by code, such as an early return.
import { matchesAny } from "./glob.ts";

/** Files that are tests by their name. Deleting one always counts, whatever it contains. */
export const TEST_NAME_GLOBS = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/test_*.py",
  "**/*_test.py",
  "**/*_test.go",
  "**/*_spec.rb",
];
/** Folders that hold tests, and also fixtures and helpers. */
export const TEST_FOLDER_GLOBS = ["**/__tests__/**", "test/**", "tests/**", "**/tests/**"];
export const DEFAULT_TEST_GLOBS = [...TEST_NAME_GLOBS, ...TEST_FOLDER_GLOBS];

export const isTestFile = (path: string, globs: string[] = DEFAULT_TEST_GLOBS) => matchesAny(globs, path);
export const isTestByName = (path: string) => matchesAny(TEST_NAME_GLOBS, path);

const DECLARATION =
  /(^|[^.\w])(it|test|Deno\.test|t\.test)(\.each\b[^(]*\([^)]*\))?\s*\(|^\s*(async\s+)?def test_\w+|^func Test\w+|#\[(\w+::)?(test|rstest)\b[^\]]*\]|^\s*@(Test|ParameterizedTest)\b|^\s*it\s+["']/gm;
const SKIP =
  /\b(it|test|describe)\.(skip|todo|only|skipIf|runIf)\b|\b(xit|xtest|xdescribe)\s*\(|\{\s*skip:\s*true|@pytest\.mark\.(skip|xfail)|\bpytest\.skip\(|pytestmark\s*=|\bt\.Skip(f|Now)?\(|#\[ignore\b|@(Disabled|Ignore)\b/g;
const ASSERTION = /\bexpect\s*\(|\bassert\w*\b|\.should\b/;

/** The text without block comments and whole-line comments, so a test that is commented out is gone. */
export const withoutComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|#(?!\[)|\*)/.test(l))
    .join("\n");

export const countDeclarations = (text: string) => [...withoutComments(text).matchAll(DECLARATION)].length;
export const countSkips = (text: string) => [...withoutComments(text).matchAll(SKIP)].length;
export const isAssertion = (line: string) => ASSERTION.test(line) && !/^\s*(\/\/|#|\*)/.test(line);
