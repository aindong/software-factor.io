// The gate sample/no-word@1. It runs in a fresh checkout of the commit the lane left, and fails
// (exit 1) when a file the run added or changed holds the word. What it prints is kept as the
// gate's evidence. FACTOR_BASE is the commit the run started from, FACTOR_HEAD the lane's commit.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const { word = "FIXME" } = JSON.parse(process.env.FACTOR_WITH ?? "{}");
const changed = execFileSync(
  "git",
  ["diff", "--name-only", "--diff-filter=AM", "-z", process.env.FACTOR_BASE, process.env.FACTOR_HEAD],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const found = changed.filter((file) => readFileSync(file, "utf8").includes(word));
if (found.length > 0) {
  console.log(`"${word}" is still in: ${found.join(", ")}`);
  process.exit(1);
}
console.log(`no "${word}" in the ${changed.length} file(s) the run changed`);
