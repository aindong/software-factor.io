// Checks workflow files against the schema and its rules. With no arguments, checks workflows/*.json.
import { readdirSync } from "node:fs";
import { reportFiles } from "../src/core/schema/check-files.ts";

const args = process.argv.slice(2);
const files =
  args.length > 0
    ? args
    : readdirSync("workflows")
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => `workflows/${f}`);
process.exit(reportFiles(files, (line) => console.log(line)) > 0 ? 1 : 0);
