// An agent can not move a lane on the ladder, in either direction.
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { judge } from "../../src/core/agents/guard.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "sf-guard-ladder-")));
const where = {
  worktree: root,
  laneDir: join(root, "lane"),
  access: "write" as const,
  defaultBranch: "main",
};

it.each([
  "npx softwarefactor ladder accept build",
  "timeout 5 softwarefactor ladder accept build",
  "npx softwarefactor escape abc123 --lane review --note x",
])("denies an agent: %s", (command) => {
  expect(judge({ tool: "Bash", input: { command } }, where).allow).toBe(false);
});
