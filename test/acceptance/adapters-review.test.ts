// Cases the plan's skeptic asked for: each is a cheap way to pass the first adapter tests without
// doing what the plan says.
import { describe, expect, it } from "vitest";
import {
  agentLane,
  alive,
  background,
  bind,
  flag,
  flowRepo,
  hooksOf,
  runRow,
  standinAccount,
  standinAlive,
  trail,
  uniqueNap,
  until,
} from "../helpers/repo.ts";

const ok = { outcome: "pass", summary: "ok" };
const KEYS = {
  ANTHROPIC_API_KEY: "k1",
  ANTHROPIC_AUTH_TOKEN: "k2",
  OPENAI_API_KEY: "k3",
  CODEX_API_KEY: "k4",
  AWS_SECRET_ACCESS_KEY: "k5",
};
const noteOf = (repo: ReturnType<typeof flowRepo>) =>
  repo.rows<{ note: string }>("select note from lane_runs order by id")[0]?.note ?? "";

describe("keys in the environment", () => {
  it.each(["claude", "codex", "kimi"] as const)("never reach %s, which starts in the worktree", (kind) => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    const profile = standinAccount(repo, "acct", kind, { actions: [{ handoff: ok }] });
    bind(repo, "author", "acct");
    Object.assign(repo.env, KEYS);
    const run = repo.sf("run");
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const call = profile.calls()[0];
    for (const key of Object.keys(KEYS)) expect(call?.env[key], key).toBeUndefined();
    expect(call?.cwd).toBe(repo.rows<{ worktree: string }>("select worktree from runs")[0]?.worktree);
  });

  it("never reach a command account, and the run says that it has no guard", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    const command = `test -z "$ANTHROPIC_API_KEY$OPENAI_API_KEY$AWS_SECRET_ACCESS_KEY" && test "$PWD" = "$FACTOR_WORKTREE" && echo '${JSON.stringify(ok)}' > "$FACTOR_HANDOFF"`;
    repo.sf("account", "add", "script", "--agent", "command", "--command", command);
    bind(repo, "author", "script");
    Object.assign(repo.env, KEYS);
    const run = repo.sf("run");
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toMatch(/no guard/);
  });
});

describe("Claude Code behind the guard", () => {
  const repo = flowRepo({
    lanes: [
      agentLane("build", {
        agent: { access: "write" },
        gates: ["verify"],
        on: { pass: "look", fail: "@stop" },
      }),
      agentLane("look", { agent: { access: "read" } }),
    ],
  });
  const profile = standinAccount(repo, "claude-a", "claude", {
    actions: [
      { tool: { name: "Write", input: { file_path: "/etc/x", content: "x" } } },
      { tool: { name: "Edit", input: { file_path: "src/a.ts" } } },
      { tool: { name: "Bash", input: { command: "git push origin main" } } },
      { handoff: ok },
    ],
  });
  bind(repo, "author", "claude-a");
  const run = repo.sf("run");
  const [write, read] = profile.calls();

  it("has every tool call judged by the hook it was given: the hook really runs", () => {
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const [outside, inside, push] = hooksOf(profile);
    expect(outside).toMatchObject({ tool: "Write", status: 2 });
    expect(outside?.stderr).toMatch(/outside the worktree/);
    expect(inside).toMatchObject({ tool: "Edit", status: 0 });
    expect(push?.status).toBe(2);
    expect(push?.stderr).toMatch(/default branch/);
  });

  it("denies the same edit on the lane that only reads", () => {
    const second = hooksOf(profile).slice(3);
    expect(second[1]).toMatchObject({ tool: "Edit", status: 2 });
  });

  it("is told the lane's folder and the branch that must not be pushed", () => {
    expect(write?.env.FACTOR_LANE_DIR?.startsWith(repo.home)).toBe(true);
    expect(write?.env.FACTOR_HANDOFF?.startsWith(write?.env.FACTOR_LANE_DIR ?? "-")).toBe(true);
    expect(write?.env.FACTOR_DEFAULT_BRANCH).toBe("main");
  });

  it("is started the way the real CLI needs, with no way round its permissions", () => {
    expect(write?.argv).toContain("--verbose");
    expect(write?.argv.join(" ")).not.toMatch(/permission-mode|skip-permissions/);
  });

  it("has file-writing tools only on the lane that may write", () => {
    expect(flag(write?.argv ?? [], "--tools")).toMatch(/Edit/);
    expect(flag(write?.argv ?? [], "--tools")).toMatch(/Write/);
    expect(flag(read?.argv ?? [], "--tools")).toMatch(/Read/);
    expect(flag(read?.argv ?? [], "--tools")).not.toMatch(/Edit|Write/);
    expect(flag(read?.argv ?? [], "--allowedTools")).not.toMatch(/Edit|Write/);
  });
});

describe("a lane that only reads", () => {
  const sneak = (commit: unknown[]) => {
    const repo = flowRepo({ lanes: [agentLane("look", { agent: { access: "read" } })] });
    const actions = [{ write: { path: "README.md", content: "changed\n" } }, ...commit, { handoff: ok }];
    const scratch = { write: { path: "scratch.txt", content: "x\n" } };
    standinAccount(repo, "claude-a", "claude", {
      actions: commit.length > 0 ? actions : [scratch, { handoff: ok }],
    });
    bind(repo, "author", "claude-a");
    const run = repo.sf("run");
    const [r] = repo.rows<{ branch: string; base_commit: string }>("select branch, base_commit from runs");
    return { repo, run, tip: repo.git("rev-parse", r?.branch ?? ""), base: r?.base_commit };
  };

  it("fails when its agent committed to the repository, and the commit is dropped", () => {
    const { repo, run, tip, base } = sneak([{ commit: "sneak" }]);
    expect(run.status).toBe(1);
    expect(noteOf(repo)).toMatch(/only reads/);
    expect(tip).toBe(base);
  });

  it("has a scratch file its agent left removed, and the run says so", () => {
    const { repo, run } = sneak([]);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toMatch(/only reads.*removed/);
    const [r] = repo.rows<{ branch: string }>("select branch from runs");
    expect(repo.git("ls-tree", "--name-only", r?.branch ?? "")).not.toContain("scratch.txt");
  });
});

describe("an agent's error", () => {
  const failing = (kind: "claude" | "codex", plan: Record<string, unknown>) => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    standinAccount(repo, "acct", kind, plan);
    bind(repo, "author", "acct");
    return { repo, status: repo.sf("run").status };
  };

  it("is read from a result that is marked as an error but shaped like a success", () => {
    const { repo, status } = failing("claude", { error: "boom two", errorAsResult: true });
    expect(status).toBe(1);
    expect(noteOf(repo)).toMatch(/boom two/);
  });

  it("fails the lane even when the agent also left a passing hand-off", () => {
    const { repo, status } = failing("claude", { actions: [{ handoff: ok }], error: "it broke after" });
    expect(status).toBe(1);
    expect(trail(repo)).toEqual(["build:fail"]);
  });

  it.each(["claude", "codex"] as const)("fails the lane when %s reports it and still exits 0", (kind) => {
    const { repo, status } = failing(kind, { error: "quiet failure", exit: 0 });
    expect(status).toBe(1);
    expect(noteOf(repo)).toMatch(/quiet failure/);
  });

  it("is not seen in ordinary text that only talks about a limit", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    const final = "The page says: you have reached your usage limit. I fixed that wording.";
    standinAccount(repo, "claude-a", "claude", { final, actions: [{ handoff: ok }] });
    bind(repo, "author", "claude-a");
    expect(repo.sf("run").status).toBe(0);
    expect(repo.sf("account", "list").stdout).not.toMatch(/held until/);
  });
});

describe("stopping Claude Code and what it started", () => {
  const late = { handoff: { outcome: "pass", summary: "late" } };

  it("when the lane's time is up", () => {
    const nap = uniqueNap(60);
    const repo = flowRepo({ lanes: [agentLane("build", { limits: { minutes: 1 } })] });
    const profile = standinAccount(repo, "claude-a", "claude", {
      actions: [{ spawn: nap }, { sleep: 20_000 }, late],
    });
    bind(repo, "author", "claude-a");
    repo.env.FACTOR_MINUTE_MS = "800";
    expect(repo.sf("run").status).toBe(1);
    expect(noteOf(repo)).toMatch(/out of time/);
    expect(alive(nap)).toBe(false);
    expect(standinAlive(profile)).toBe(false);
  }, 30_000);

  it("when a person stops the run", async () => {
    const nap = uniqueNap(60);
    const repo = flowRepo({ lanes: [agentLane("build")] });
    const profile = standinAccount(repo, "claude-a", "claude", {
      actions: [{ spawn: nap }, { sleep: 20_000 }, late],
    });
    bind(repo, "author", "claude-a");
    const run = background(repo, "run");
    expect(await until(() => alive(nap))).toBe(true);
    expect(repo.sf("stop", runRow(repo)?.id ?? "").status).toBe(0);
    await run.exit;
    expect(alive(nap)).toBe(false);
    expect(standinAlive(profile)).toBe(false);
    expect(runRow(repo)).toMatchObject({ status: "stopped", stop_code: "stopped_by_person" });
    expect(trail(repo)).toEqual(["build:fail"]);
  }, 30_000);
});
