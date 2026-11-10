// Cases from the security review of task 10: what an agent could do to the host through the
// host's own steps after a lane, and through the hook.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentLane,
  background,
  bind,
  flag,
  flowRepo,
  type Profile,
  runRow,
  standinAccount,
} from "../helpers/repo.ts";

const ok = { outcome: "pass", summary: "ok" };
const writeLane = () => agentLane("build", { agent: { access: "write" }, gates: ["verify"] });
const readLane = () => agentLane("look", { agent: { access: "read" } });

describe("the host's own git steps after a lane", () => {
  it("never clean outside the run's worktree when the agent rewrote .git", () => {
    const victim = realpathSync(mkdtempSync(join(tmpdir(), "sf-victim-")));
    writeFileSync(join(victim, "precious.txt"), "uncommitted work\n");
    const repo = flowRepo({ lanes: [readLane()] });
    const config = `[core]\n\trepositoryformatversion = 0\n\tworktree = ${victim}\n`;
    standinAccount(repo, "claude-a", "claude", {
      actions: [
        { write: { path: "fakeg/HEAD", content: "ref: refs/heads/x\n" } },
        { write: { path: "fakeg/objects/keep", content: "" } },
        { write: { path: "fakeg/refs/keep", content: "" } },
        { write: { path: "fakeg/config", content: config } },
        { write: { path: ".git", content: "gitdir: fakeg\n" } },
        { handoff: ok },
      ],
    });
    bind(repo, "author", "claude-a");
    expect(repo.sf("run").status).toBe(1);
    expect(existsSync(join(victim, "precious.txt"))).toBe(true);
    expect(runRow(repo)?.stop_code).toBe("git_config_changed");
  });

  it("never commit onto the default branch when the agent pointed .git at the main repository", () => {
    const repo = flowRepo({ lanes: [writeLane()] });
    standinAccount(repo, "claude-a", "claude", {
      actions: [
        { write: { path: "evil.txt", content: "x\n" } },
        { write: { path: ".git", content: `gitdir: ${join(repo.dir, ".git")}\n` } },
        { handoff: ok },
      ],
    });
    bind(repo, "author", "claude-a");
    expect(repo.sf("run").status).toBe(1);
    expect(repo.git("ls-tree", "--name-only", "main")).not.toContain("evil.txt");
    expect(repo.git("status", "--porcelain")).toBe("");
  });

  it("never commit onto another branch when the agent moved the worktree's HEAD", () => {
    const repo = flowRepo({ lanes: [writeLane()] });
    repo.git("branch", "other");
    standinAccount(repo, "claude-a", "claude", {
      actions: [
        { sh: "git symbolic-ref HEAD refs/heads/other" },
        { write: { path: "evil.txt", content: "x\n" } },
        { handoff: ok },
      ],
    });
    bind(repo, "author", "claude-a");
    expect(repo.sf("run").status).toBe(1);
    expect(repo.git("ls-tree", "--name-only", "other")).not.toContain("evil.txt");
  });
});

describe("the hook Claude Code is given", () => {
  const repo = flowRepo({ lanes: [readLane()] });
  const profile: Profile = standinAccount(repo, "claude-a", "claude", { actions: [{ handoff: ok }] });
  bind(repo, "author", "claude-a");
  repo.sf("run");
  const call = profile.calls()[0];
  const settings = JSON.parse(flag(call?.argv ?? [], "--settings") ?? "{}");
  const command: string = settings.hooks.PreToolUse[0].hooks[0].command;
  const ask = (input: unknown, env: Record<string, string> = {}) =>
    spawnSync("sh", ["-c", command], {
      input: JSON.stringify(input),
      env: { ...call?.env, PATH: process.env.PATH ?? "", ...env },
      encoding: "utf8",
    }).status;
  const ls = { tool_name: "Bash", tool_input: { command: "ls" } };
  const edit = { tool_name: "Edit", tool_input: { file_path: "README.md" } };

  it("allows ordinary work", () => {
    expect(ask(ls)).toBe(0);
  });

  it("turns a guard that cannot start into a denial: a broken hook must not let the call through", () => {
    const cli = process.argv[1] ?? "";
    expect(command).toContain("src/cli.ts");
    const broken = command.replace(/'[^']*src\/cli\.ts'/, "'/nonexistent/cli.ts'");
    expect(spawnSync("sh", ["-c", broken], { input: JSON.stringify(ls) }).status).toBe(2);
    expect(cli).toBeTruthy();
  });

  it("runs with an empty environment, so nothing the CLI passes it can change what it loads", () => {
    const poisoned = { NODE_OPTIONS: "--require /nonexistent/sf-proof.cjs" };
    expect(ask(ls, poisoned)).toBe(0);
    expect(ask(edit, poisoned)).toBe(2);
  });

  it("is told the lane on its command line, so the environment cannot widen it", () => {
    expect(ask(edit)).toBe(2); // this lane only reads
    expect(ask(edit, { FACTOR_ACCESS: "write", FACTOR_LANE_DIR: "/", FACTOR_WORKTREE: "/" })).toBe(2);
  });

  it("comes with a start that ignores the worktree's own settings, hooks and MCP servers", () => {
    expect(call?.argv).toContain("--strict-mcp-config");
    expect(flag(call?.argv ?? [], "--setting-sources")).toBe("user");
  });
});

describe("a hand-off file that is not a file", () => {
  it("does not hang the run when it is a pipe", async () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    standinAccount(repo, "claude-a", "claude", { actions: [{ sh: 'mkfifo "$FACTOR_HANDOFF"' }] });
    bind(repo, "author", "claude-a");
    const run = background(repo, "run");
    const code = await Promise.race([run.exit, new Promise((r) => setTimeout(() => r("hung"), 15_000))]);
    run.child.kill("SIGKILL");
    expect(code).toBe(1);
  }, 30_000);

  it("is not read through a link to a file elsewhere", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    const elsewhere = join(repo.home, "elsewhere.json");
    writeFileSync(elsewhere, JSON.stringify(ok));
    standinAccount(repo, "claude-a", "claude", { actions: [{ sh: `ln -s ${elsewhere} "$FACTOR_HANDOFF"` }] });
    bind(repo, "author", "claude-a");
    expect(repo.sf("run").status).toBe(1);
  });
});
