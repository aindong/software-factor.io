// An agent can not stop a run from inside a lane: the page's Stop button is for the person.
import { join } from "node:path";
import { expect, it } from "vitest";
import { judge } from "../../src/core/agents/guard.ts";

const where = {
  worktree: process.cwd(),
  laneDir: join(process.cwd(), "lane"),
  access: "write" as const,
  defaultBranch: "main",
};

it.each(["softwarefactor stop abc123", "npx softwarefactor stop abc123", "softwarefactor ui"])(
  "denies an agent: %s",
  (command) => {
    expect(judge({ tool: "Bash", input: { command } }, where).allow).toBe(false);
  },
);
