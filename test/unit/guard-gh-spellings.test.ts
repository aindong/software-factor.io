// From the second security look at task 18: a list of what gh may not do is passed by every other
// spelling. An agent's gh is held to what it may do: read, and open its own pull request.
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { judge } from "../../src/core/agents/guard.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "sf-guard-gh2-")));
const where = {
  worktree: root,
  laneDir: join(root, "lane"),
  access: "write" as const,
  defaultBranch: "main",
};
const bash = (command: string) => judge({ tool: "Bash", input: { command } }, where);

it.each([
  "gh pr -t x merge 12 --admin",
  "gh pr -t view merge 12 --admin",
  "gh repo --yes acme/shop delete",
  "gh variable --env prod set NAME --body v",
  "gh alias set mm 'pr merge'",
  "gh mm 12 --admin",
  "gh extension install someone/gh-merge",
  "gh config set editor vim",
  "gh gist create --public notes.txt",
  "gh repo create acme/copy --public",
  "gh issue comment 12 --body-file src/secret.ts",
  "gh pr edit 12 --add-label automerge",
  "gh issue close 12",
  'curl -X PUT -H "Authorization: token $(gh auth token)" https://api.github.com/repos/acme/shop/pulls/1/merge',
  "t=`gh auth token`; echo $t",
  "timeout 60 gh pr merge 1 --admin",
  "env -i gh pr merge 1",
  "nice -n1 gh pr merge 1",
  "find . -maxdepth 0 -exec gh pr merge 1 --admin ;",
  "gh api -X GET graphql -f query=mutation",
  "gh api graphql -f query=x",
  '/opt/homebrew/bin/gh "pr" merge 1',
])("denies: %s", (command) => {
  expect(bash(command).allow).toBe(false);
});

it.each([
  "gh --version",
  "gh status",
  "gh pr view 12 -R acme/shop",
  "gh pr checks 12 --watch",
  "gh pr list --state open --json number,title",
  "gh search issues crash --repo acme/shop",
  "gh repo view acme/shop --json defaultBranchRef",
  "gh run list --limit 5",
  "gh api -X GET repos/acme/shop/issues",
  'gh pr create --title "Fix the export" --body "Closes #12"',
])("allows: %s", (command) => {
  expect(bash(command).allow).toBe(true);
});
