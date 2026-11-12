// An agent can not requeue a task: it would set its own failed work going again.
import { join } from "node:path";
import { expect, it } from "vitest";
import { judge } from "../../src/core/agents/guard.ts";

const where = {
  worktree: process.cwd(),
  laneDir: join(process.cwd(), "lane"),
  access: "write" as const,
  defaultBranch: "main",
};

it.each([
  "softwarefactor requeue abc123",
  "npx softwarefactor requeue abc123",
  "softwarefactor resume abc123",
])("denies an agent: %s", (command) => {
  expect(judge({ tool: "Bash", input: { command } }, where).allow).toBe(false);
});
