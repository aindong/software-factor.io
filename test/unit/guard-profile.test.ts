// The files an agent CLI starts servers and skills from are not the agent's to write, on any lane:
// the CLI's own config file, its profile folders, and any folder of its own at any depth.
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeArgs } from "../../src/core/agents/claude-args.ts";
import { judge } from "../../src/core/agents/guard.ts";
import type { AgentJob } from "../../src/core/agents/types.ts";
import { hookFor } from "../helpers/hook.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "sf-guard-profile-")));
const worktree = join(root, "wt");
const laneDir = join(root, "lane");
const profile = join(root, "profiles", "work");
for (const dir of [worktree, laneDir, profile, join(worktree, "src")]) mkdirSync(dir, { recursive: true });
const where = (extra = {}) => ({
  worktree,
  laneDir,
  access: "write" as const,
  defaultBranch: "main",
  ...extra,
});
const bash = (command: string, extra = {}) => judge({ tool: "Bash", input: { command } }, where(extra));
const write = (tool: string, file_path: string, extra = {}) =>
  judge({ tool, input: { file_path } }, where(extra));

describe("the CLI's own config file and profile folders", () => {
  it.each([
    "echo x >> ~/.claude.json",
    "echo x >> $HOME/.claude.json.backup",
    "cat > /home/someone/.claude.json",
    "echo x > ~/.claude-work/settings.json",
    "cp a ~/.claude-personal/",
    "echo x > ~/.codex-work/config.toml",
  ])("denies the shell command %s on a lane that names nothing", (command) => {
    expect(bash(command).allow).toBe(false);
    expect(bash(command, { servers: ["docs"], skills: ["s"] }).allow).toBe(false);
  });

  it("denies a shell command that names the lane's account profile folder, wherever it is", () => {
    expect(bash(`echo x > ${profile}/settings.json`).allow).toBe(true); // unknown without --profile
    expect(bash(`echo x > ${profile}/settings.json`, { profile }).allow).toBe(false);
    expect(bash("ls", { profile }).allow).toBe(true);
  });

  it("denies a write inside the lane's account profile folder", () => {
    expect(write("Write", join(profile, "settings.json"), { profile }).allow).toBe(false);
    expect(write("Edit", join(profile, ".claude.json"), { profile }).allow).toBe(false);
  });

  it("tells the guard the profile folder only for a lane that names servers", () => {
    const job = (extra: Partial<AgentJob>) =>
      ({
        runId: "r",
        lane: { id: "x", agent: { access: "read" } },
        cwd: "/w",
        laneDir: "/l",
        ...extra,
      }) as AgentJob;
    const sealed = claudeArgs(job({}), {}, ["g"], undefined, "/p/work").join(" ");
    expect(sealed).not.toContain("--profile");
    const named = claudeArgs(job({ servers: ["docs"] }), {}, ["g"], ["docs"], "/p/work").join(" ");
    expect(named).toContain("'--profile' '/p/work'");
  });

  it("denies, through the hook of a lane's arguments, a write to the config file", () => {
    const hook = hookFor({ servers: ["docs"] }, ["docs"]);
    expect(hook("Bash", { command: "echo x >> ~/.claude.json" })).toBe(2);
    expect(hookFor({})("Bash", { command: "echo x >> ~/.claude.json" })).toBe(2);
  });
});

describe("a folder of an agent CLI at any depth", () => {
  it.each([".claude", ".codex", ".kimi-code", ".agents"])(
    "denies writing a file below %s deep in the tree",
    (dir) => {
      const file = join(worktree, "src", dir, "skills", "x", "SKILL.md");
      expect(write("Write", file).allow).toBe(false);
      expect(write("Edit", file).allow).toBe(false);
      expect(write("NotebookEdit", file).allow).toBe(false);
      expect(bash(`echo hook > src/${dir}/skills/x/SKILL.md`).allow).toBe(false);
      expect(bash(`mkdir -p src/${dir}/skills/x`).allow).toBe(false);
    },
  );

  it("still allows ordinary files, also with similar names", () => {
    expect(write("Write", join(worktree, "src", "claude.ts")).allow).toBe(true);
    expect(write("Write", join(worktree, "src", ".github", "x.yml")).allow).toBe(true);
    expect(bash("git add -A && git commit -m 'Fix the .github folder'").allow).toBe(true);
  });
});
