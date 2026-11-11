// Copies the stageshow kit and its filming scripts into demo/.stageshow (ignored by git) and installs
// what they need there. The skill folder is never written to. Needs the stageshow skill: STAGESHOW_HOME,
// or ~/.claude/skills/stageshow.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const home = process.env.STAGESHOW_HOME ?? join(homedir(), ".claude", "skills", "stageshow");
const dest = join(dirname(fileURLToPath(import.meta.url)), ".stageshow");
if (!existsSync(join(home, "kit"))) {
  console.error(`The stageshow skill is not at ${home}. Install it, or set STAGESHOW_HOME to its folder.`);
  process.exit(2);
}
mkdirSync(dest, { recursive: true });
for (const name of ["kit", "scripts", "LICENSE", "NOTICE.md", "package.json", "package-lock.json"]) {
  if (existsSync(join(home, name))) cpSync(join(home, name), join(dest, name), { recursive: true });
}
execFileSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: dest, stdio: "inherit" });
console.log(`stageshow is ready in ${dest}`);
