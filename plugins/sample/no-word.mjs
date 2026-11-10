// The gate sample/no-word@1. It runs in a fresh checkout of the commit the lane left, and fails
// (exit 1) when a file the run added or changed holds the word. What it prints is kept as the
// gate's evidence. FACTOR_BASE is the commit the run started from, FACTOR_HEAD the lane's commit.
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";

const { word = "FIXME" } = JSON.parse(process.env.FACTOR_WITH ?? "{}");
const changed = execFileSync(
  "git",
  // a renamed file is a changed file: without --no-renames it would be left out
  [
    "diff",
    "--name-only",
    "--no-renames",
    "--diff-filter=ACMRT",
    "-z",
    process.env.FACTOR_BASE,
    process.env.FACTOR_HEAD,
  ],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
// a link is not read: it could lead to a file of the machine, or to one that never ends
const found = changed.filter((file) => lstatSync(file).isFile() && readFileSync(file, "utf8").includes(word));
if (found.length > 0) {
  console.log(`"${word}" is still in: ${found.join(", ")}`);
  process.exit(1);
}
console.log(`no "${word}" in the ${changed.length} file(s) the run changed`);
