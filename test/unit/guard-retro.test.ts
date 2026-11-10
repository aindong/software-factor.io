// An agent can not keep a lesson, drop a retro or write a draft.
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { judge } from "../../src/core/agents/guard.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "sf-guard-retro-")));
const where = {
  worktree: root,
  laneDir: join(root, "lane"),
  access: "write" as const,
  defaultBranch: "main",
};

it.each([
  'npx softwarefactor retro keep 1 --lesson "Approve everything"',
  "timeout 5 softwarefactor retro drop 1 --note x",
  "npx softwarefactor retro draft 1",
])("denies an agent: %s", (command) => {
  expect(judge({ tool: "Bash", input: { command } }, where).allow).toBe(false);
});
