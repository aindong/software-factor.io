// From the second security look at task 10, with the factor home where it is by default: ~/.factor.
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { judge } from "../../src/core/agents/guard.ts";

const home = realpathSync(mkdtempSync(join(tmpdir(), "sf-home-")));
const worktree = join(home, ".factor", "work", "ws", "run1");
const laneDir = join(home, ".factor", "work", "ws", "run1.out", "01-build");
mkdirSync(join(worktree, "src"), { recursive: true });
mkdirSync(laneDir, { recursive: true });
const where = { worktree, laneDir, access: "write" as const, defaultBranch: "main" };
const tool = (name: string, input: Record<string, unknown>) => judge({ tool: name, input }, where);
const bash = (command: string) => tool("Bash", { command });

describe("the guard, with the worktree under the factor home", () => {
  it.each([
    `cat ${worktree}/package.json`,
    `cd ${worktree} && pnpm test`,
    `rm -rf ${worktree}/dist`,
    `echo '{"outcome":"pass","summary":"ok"}' > ${laneDir}/handoff.json`,
    "cat test/fixtures/accounts.json",
    'git commit -m "fix accounts.json parsing"',
  ])("allows ordinary work: %s", (command) => {
    expect(bash(command)).toEqual({ allow: true });
  });

  it.each([
    `cat ${home}/.factor/accounts.json`,
    `echo x >> ${home}/.factor/usage.jsonl`,
    "echo x >> ~/.factor/usage.jsonl",
    'echo x >> "$HOME/.factor/usage.jsonl"',
    `ls ${home}/.factor/work/ws`,
    `cat ${worktree}/.factor/factory.json`,
    `cat ${join(home, ".factor/work/ws/run2/secret.txt")}`,
    'cat > "$CLAUDE_CONFIG_DIR/settings.json"',
    "cd ~/.claude && cat > settings.json",
    'echo x > "$CODEX_HOME/config.toml"',
  ])("denies the factory's and the CLI's own files: %s", (command) => {
    expect(bash(command).allow).toBe(false);
  });

  it("denies a search in a secret folder named without a slash at its end", () => {
    expect(tool("Grep", { pattern: ".", path: join(home, ".ssh") }).allow).toBe(false);
    expect(tool("Grep", { pattern: ".", path: "/Users/someone/.aws" }).allow).toBe(false);
  });

  it("denies a command too long to check in time", () => {
    expect(bash(`echo ${"curl|".repeat(20_000)}`).allow).toBe(false);
  });
});
