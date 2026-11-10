// The gate sample/no-word@1. It runs in a fresh checkout of the commit the lane left, and fails
// (exit 1) when a tracked file holds the word. What it prints is kept as the gate's evidence.
import { execFileSync } from "node:child_process";

const { word = "FIXME" } = JSON.parse(process.env.FACTOR_WITH ?? "{}");
let found = "";
try {
  found = execFileSync("git", ["grep", "-n", "-I", "-F", "-e", word, "--", "."], { encoding: "utf8" });
} catch {
  // git grep exits 1 when nothing matches: that is a pass
}
if (found) {
  console.log(`"${word}" is still in:\n${found}`);
  process.exit(1);
}
console.log(`no "${word}" in the change`);
