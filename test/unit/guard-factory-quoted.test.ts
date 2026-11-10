// From the correctness review of task 22: the factory's command behind quotes or a backslash is
// still the factory's command, and a word in a message is still a word.
import { join } from "node:path";
import { expect, it } from "vitest";
import { judge } from "../../src/core/agents/guard.ts";

const where = {
  worktree: process.cwd(),
  laneDir: join(process.cwd(), "lane"),
  access: "write" as const,
  defaultBranch: "main",
};
const bash = (command: string) => judge({ tool: "Bash", input: { command } }, where).allow;

it.each([
  'npx softwarefactor "retro" keep 1 --lesson x',
  "FACTOR_RUN_ID= timeout 5 softwarefactor r\\etro keep 1 --lesson x",
  "npx softwarefactor 'approve' abc",
  'npx "softwarefactor" ladder accept build',
])("denies %s", (command) => {
  expect(bash(command)).toBe(false);
});

it.each([
  'git commit -m "Make softwarefactor safe to run; tidy"',
  'git commit -m "softwarefactor: add the export command"',
  "grep -rn softwarefactor docs",
  "cat node_modules/softwarefactor/README.md",
])("allows %s", (command) => {
  expect(bash(command)).toBe(true);
});
