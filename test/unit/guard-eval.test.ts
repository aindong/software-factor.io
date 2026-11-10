// An agent can not run the factory's evals (it could break a gate in them and read how).
import { join } from "node:path";
import { expect, it } from "vitest";
import { judge } from "../../src/core/agents/guard.ts";

const where = {
  worktree: process.cwd(),
  laneDir: join(process.cwd(), "lane"),
  access: "write" as const,
  defaultBranch: "main",
};

it.each(["npx softwarefactor eval", "timeout 60 softwarefactor eval --break core/tests-not-weakened@1"])(
  "denies an agent: %s",
  (command) => {
    expect(judge({ tool: "Bash", input: { command } }, where).allow).toBe(false);
  },
);
