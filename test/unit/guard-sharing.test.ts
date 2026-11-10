// An agent can not bring a workflow in or take one out.
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { judge } from "../../src/core/agents/guard.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "sf-guard-sharing-")));
const where = {
  worktree: root,
  laneDir: join(root, "lane"),
  access: "write" as const,
  defaultBranch: "main",
};

it.each([
  "softwarefactor import shared.json --yes --use",
  "npx softwarefactor import shared.json --yes",
  "npx softwarefactor export --out /tmp/x.json",
  "timeout 5 softwarefactor export",
])("denies an agent: %s", (command) => {
  expect(judge({ tool: "Bash", input: { command } }, where).allow).toBe(false);
});
