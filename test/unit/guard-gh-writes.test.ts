// From the security review of task 18: an issue written by an outsider now reaches an agent, so
// the agent must not be able to land a change on GitHub with the person's own gh login.
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { judge } from "../../src/core/agents/guard.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "sf-guard-gh-")));
const where = {
  worktree: root,
  laneDir: join(root, "lane"),
  access: "write" as const,
  defaultBranch: "main",
};
const bash = (command: string) => judge({ tool: "Bash", input: { command } }, where);

it.each([
  "gh pr merge 12 --admin --squash",
  "gh api -X PUT repos/acme/shop/pulls/12/merge",
  "gh api --method POST repos/acme/shop/issues -f title=x",
  "gh api repos/acme/shop/issues -f title=x",
  "gh repo delete acme/shop --yes",
  "gh release create v1",
  "gh secret set TOKEN",
  "gh workflow run deploy.yml",
  "npx softwarefactor mcp-call",
  "npx softwarefactor allow board",
])("denies an agent: %s", (command) => {
  expect(bash(command).allow).toBe(false);
});

it.each([
  "gh issue view 12",
  "gh issue list --label bug",
  "gh pr view 12 --json title",
  "gh pr create --title x --body y",
  "gh pr diff 12",
  "gh api repos/acme/shop/pulls/12",
  "gh run view 5 --log",
])("still lets an agent read GitHub and open a pull request: %s", (command) => {
  expect(bash(command).allow).toBe(true);
});
