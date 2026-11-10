// Checks workflow files and reports each problem with its place and fix. The command line and the
// repository's own check script both use it.
import { readFileSync } from "node:fs";
import { type Problem, parseWorkflow } from "./parse.ts";

export function checkFile(file: string): Problem[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return [
      {
        path: "(file)",
        message: `Cannot read the file: ${(error as Error).message}`,
        fix: "Check the path.",
      },
    ];
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return [
      { path: "(file)", message: `Not valid JSON: ${(error as Error).message}`, fix: "Fix the JSON syntax." },
    ];
  }
  return parseWorkflow(json).problems;
}

/** Prints one line per file, then its problems. Returns how many files had problems. */
export function reportFiles(files: string[], print: (line: string) => void): number {
  let failed = 0;
  for (const file of files) {
    const problems = checkFile(file);
    if (problems.length === 0) {
      print(`ok    ${file}`);
      continue;
    }
    failed += 1;
    print(`FAIL  ${file}`);
    for (const p of problems) print(`      ${p.path}: ${p.message}\n        fix: ${p.fix}`);
  }
  if (files.length === 0) {
    print("no workflow files found");
    failed = 1;
  }
  return failed;
}
