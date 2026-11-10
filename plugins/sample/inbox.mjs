// The collector sample/inbox@1. It runs in the workspace, reads its settings from FACTOR_WITH,
// and prints the tasks it found as a JSON list. It changes nothing.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { folder = "inbox" } = JSON.parse(process.env.FACTOR_WITH ?? "{}");
const tasks = [];
for (const file of existsSync(folder) ? readdirSync(folder).sort() : []) {
  if (!file.endsWith(".md")) continue;
  const lines = readFileSync(join(folder, file), "utf8").split("\n");
  const at = lines.findIndex((line) => line.startsWith("# "));
  if (at < 0) continue; // a note with no heading is not a task yet
  tasks.push({
    key: file,
    title: lines[at].slice(2).trim(),
    body: lines
      .slice(at + 1)
      .join("\n")
      .trim(),
  });
}
console.log(JSON.stringify(tasks));
