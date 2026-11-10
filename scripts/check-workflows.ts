// Checks workflow files against the schema and its rules. With no arguments, checks workflows/*.json.
import { readdirSync, readFileSync } from "node:fs";
import { parseWorkflow } from "../src/core/schema/parse.ts";

const args = process.argv.slice(2);
const files =
  args.length > 0
    ? args
    : readdirSync("workflows")
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => `workflows/${f}`);

let failed = 0;
for (const file of files) {
  let problems: { path: string; message: string; fix: string }[];
  try {
    problems = parseWorkflow(JSON.parse(readFileSync(file, "utf8"))).problems;
  } catch (error) {
    problems = [
      {
        path: "(file)",
        message: `Cannot read as JSON: ${(error as Error).message}`,
        fix: "Fix the JSON syntax.",
      },
    ];
  }
  if (problems.length === 0) {
    console.log(`ok    ${file}`);
    continue;
  }
  failed += 1;
  console.log(`FAIL  ${file}`);
  for (const p of problems) console.log(`      ${p.path}: ${p.message}\n        fix: ${p.fix}`);
}
if (files.length === 0) {
  console.log("no workflow files found");
  failed = 1;
}
process.exit(failed > 0 ? 1 : 0);
