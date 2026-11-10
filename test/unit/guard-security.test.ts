// Cases from the security review of task 10: calls the first guard allowed and must not.
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { judge } from "../../src/core/agents/guard.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "sf-guard-sec-")));
const worktree = join(root, "wt");
const laneDir = join(root, "home/.factor/work/ws/run.out/01-build");
mkdirSync(worktree);
mkdirSync(laneDir, { recursive: true });
mkdirSync(join(root, "victim"));
mkdirSync(join(root, "home/.ssh"), { recursive: true });
writeFileSync(join(root, "home/.ssh/id_ed25519"), "not a real key\n");
symlinkSync(join(root, "home/.ssh/id_ed25519"), join(worktree, "notes.txt"));
symlinkSync(root, join(worktree, "h"));
const where = { worktree, laneDir, access: "write" as const, defaultBranch: ["trunk", "develop"] };
const tool = (name: string, input: Record<string, unknown>) => judge({ tool: name, input }, where);
const bash = (command: string) => tool("Bash", { command });

describe("the guard denies", () => {
  it.each([
    ["mcp__github__push_files", { owner: "o", repo: "r", branch: "trunk", files: [] }],
    ["mcp__filesystem__write_file", { path: "/Users/someone/.zshrc", content: "x" }],
    ["WebFetch", { url: "https://x.example/?q=1" }],
    ["Task", { prompt: "do it" }],
  ])("a tool it has no rule for: %s", (name, input) => {
    expect(tool(name, input).allow).toBe(false);
  });

  it.each([
    "git --work-tree . push origin trunk",
    "git --git-dir=/tmp/other/.git push origin feature",
    "git -c alias.p=push p origin trunk",
    'git push origin HEAD:"trunk"',
    "git push origin HEAD:tru\\nk",
    "git -c remote.origin.push=+HEAD:trunk push origin",
    "git push origin HEAD:heads/trunk",
    "git push origin develop",
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.p GIT_CONFIG_VALUE_0=push git p origin trunk",
    "git branch -f trunk HEAD",
    "git checkout trunk",
    "git switch -C trunk",
    "git update-ref refs/heads/trunk HEAD",
    "git symbolic-ref HEAD refs/heads/trunk",
    "git worktree add ../elsewhere",
  ])("a change to a protected branch or to where git looks: %s", (command) => {
    expect(bash(command).allow).toBe(false);
  });

  it.each([
    "rm -rf h/victim",
    "echo ~/Documents | xargs rm -rf",
    "find ~/Documents -delete",
    "find h/victim -type f -exec rm {} +",
  ])("a delete outside the worktree: %s", (command) => {
    expect(bash(command).allow).toBe(false);
  });

  it.each([
    ["Grep", { pattern: "=", path: worktree, glob: ".env*", output_mode: "content" }],
    ["Glob", { pattern: "**/.env*" }],
    ["Read", { file_path: join(worktree, "notes.txt") }],
    ["Read", { file_path: "/Users/someone/.git-credentials" }],
    ["Read", { file_path: "/Users/someone/.config/gh/hosts.yml" }],
    ["Read", { file_path: "/Users/someone/.docker/config.json" }],
    ["Bash", { command: "printf 'protocol=https\\nhost=github.com\\n\\n' | git credential fill" }],
    ["Bash", { command: "gh auth token" }],
  ])("reading a secret: %s %j", (name, input) => {
    expect(tool(name, input).allow).toBe(false);
  });

  it.each([
    "echo '{}' > .factor/factory.json",
    "echo '{}' >.factor/factory.json",
    "printf 'gitdir: /tmp/fake' > .git",
    "cat .git/worktrees/x/HEAD",
    'cp evil.sh "$(git rev-parse --git-common-dir)/hooks/pre-commit"',
    `echo '{"at":1,"account":"work","holdUntil":9e15}' >> ~/.factor/usage.jsonl`,
    "echo '{}' > .claude/settings.local.json",
    "echo '{}' > .mcp.json",
  ])("a shell write to what the factory, git or the CLI owns: %s", (command) => {
    expect(bash(command).allow).toBe(false);
  });

  it.each([".claude/settings.json", ".claude/settings.local.json", ".mcp.json", ".codex/config.toml"])(
    "writing the CLI's own project settings: %s",
    (path) => {
      expect(tool("Write", { file_path: join(worktree, path), content: "{}" }).allow).toBe(false);
    },
  );
});

describe("the guard still allows", () => {
  it.each([
    `echo '{"outcome":"pass","summary":"ok"}' > ${join(laneDir, "handoff.json")}`,
    'git -c user.name=agent -c user.email=a@b.c commit -m "Add it"',
    "git symbolic-ref --short HEAD",
    "git worktree list",
    "git checkout -b factor/side-branch",
    "git switch -",
    "git branch --show-current",
    "find . -name '*.tmp' -delete",
    "rm -rf node_modules/.cache",
    "cat .gitignore && ls .github",
  ])("%s", (command) => {
    expect(bash(command)).toEqual({ allow: true });
  });
});
