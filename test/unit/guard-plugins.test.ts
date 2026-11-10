// An agent can not install a plugin, allow anything, or change what is installed.
import { mkdtempSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { judge } from "../../src/core/agents/guard.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "sf-guard-plugins-")));
const where = {
  worktree: root,
  laneDir: join(root, "lane"),
  access: "write" as const,
  defaultBranch: "main",
};

it.each([
  "softwarefactor add acme/board --yes",
  "npx softwarefactor add acme/board --yes",
  "npx softwarefactor allow --skill review",
  `echo x >> ${homedir()}/.factor/plugins/acme/gate.sh`,
  "echo '{}' > .factor/plugins.lock.json",
])("denies an agent: %s", (command) => {
  expect(judge({ tool: "Bash", input: { command } }, where).allow).toBe(false);
});

it.each([
  join(homedir(), ".factor/plugins/acme/gate.sh"),
  join(root, ".factor/plugins.lock.json"),
  join(root, ".factor/local.json"),
])("denies an agent a write to %s", (file_path) => {
  expect(judge({ tool: "Write", input: { file_path, content: "x" } }, where).allow).toBe(false);
});
