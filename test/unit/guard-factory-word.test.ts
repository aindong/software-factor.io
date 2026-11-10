// From the security review of task 12: the rule against the factory's own command must not stop
// ordinary work on a project that has the word in it, such as this one.
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { judge } from "../../src/core/agents/guard.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "sf-guard-word-")));
const where = {
  worktree: root,
  laneDir: join(root, "lane"),
  access: "write" as const,
  defaultBranch: "main",
};
const bash = (command: string) => judge({ tool: "Bash", input: { command } }, where);

describe("the guard and the word softwarefactor", () => {
  it.each([
    'pnpm vitest run -t "softwarefactor mcp"',
    "find . -name softwarefactor",
    "pnpm --filter softwarefactor test",
    "ls node_modules/.bin/softwarefactor",
    "grep -r softwarefactor docs",
    "node src/cli.ts check",
  ])("allows ordinary work: %s", (command) => {
    expect(bash(command)).toEqual({ allow: true });
  });

  it.each([
    "softwarefactor memory keep 1",
    "node_modules/.bin/softwarefactor approve abc",
    "npx softwarefactor approve abc",
    "npx --yes softwarefactor approve abc",
    "pnpm exec softwarefactor approve abc",
    "pnpm dlx softwarefactor approve abc",
    "bunx softwarefactor approve abc",
    "cd /somewhere && softwarefactor approve abc",
    "env FOO=1 softwarefactor approve abc",
  ])("denies the command itself: %s", (command) => {
    expect(bash(command).allow).toBe(false);
  });
});

describe("the guard and the interface's server", () => {
  it.each([
    "softwarefactor ui",
    "env -u FACTOR_RUN_ID softwarefactor ui --port 0",
    "npx softwarefactor ui &",
  ])("denies an agent starting it: %s", (command) => {
    expect(bash(command).allow).toBe(false);
  });
});
