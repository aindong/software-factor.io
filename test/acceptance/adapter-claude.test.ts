import { describe, expect, it } from "vitest";
import {
  agentLane,
  bind,
  flag,
  flowRepo,
  promptsOf,
  runRow,
  standinAccount,
  trail,
} from "../helpers/repo.ts";

const ok = { outcome: "pass", summary: "Built it." };
const build = [{ write: { path: "a.txt", content: "a\n" } }, { commit: "Add a" }, { handoff: ok }];

describe("a lane worked by Claude Code", () => {
  const repo = flowRepo({
    lanes: [
      agentLane("build", {
        agent: { access: "write", tier: "large", effort: "high" },
        gates: ["verify"],
        on: { pass: "look", fail: "@stop" },
      }),
      agentLane("look", { agent: { access: "read", tier: "small" } }),
    ],
  });
  const profile = standinAccount(repo, "claude-a", "claude", { actions: build });
  bind(repo, "author", "claude-a", "--large", "opus", "--small", "haiku");
  const run = repo.sf("run");
  const [first, second] = profile.calls();

  it("finishes, with the work committed on the run's branch", () => {
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(trail(repo)).toEqual(["build:pass", "look:pass"]);
    const [r] = repo.rows<{ branch: string }>("select branch from runs");
    expect(repo.git("ls-tree", "--name-only", r?.branch ?? "")).toContain("a.txt");
  });

  it("was started in the worktree, in print mode with a stream, under the account's profile", () => {
    const [r] = repo.rows<{ worktree: string }>("select worktree from runs");
    expect(first?.cwd).toBe(r?.worktree);
    expect(first?.argv).toContain("-p");
    expect(flag(first?.argv ?? [], "--output-format")).toBe("stream-json");
    expect(first?.env.CLAUDE_CONFIG_DIR).toBe(profile.dir);
  });

  it("got the model for the lane's tier, the effort, and the prompt on stdin", () => {
    expect(flag(first?.argv ?? [], "--model")).toBe("opus");
    expect(flag(first?.argv ?? [], "--effort")).toBe("high");
    expect(flag(second?.argv ?? [], "--model")).toBe("haiku");
    expect(first?.stdin).toContain("Do the build step.");
    expect(first?.stdin).toContain("Do the thing");
    expect(promptsOf(repo, "build")[0]).toBe(first?.stdin); // the record holds what the agent was told
  });

  it("was told where to leave its hand-off and evidence, outside the repository", () => {
    expect(first?.env.FACTOR_HANDOFF?.startsWith(repo.home)).toBe(true);
    expect(first?.env.FACTOR_EVIDENCE_DIR?.startsWith(repo.home)).toBe(true);
    expect(first?.stdin).toContain(first?.env.FACTOR_HANDOFF);
    expect(first?.env.FACTOR_PORT).toBeTruthy(); // the run's slot, for anything the agent starts
  });

  it("ran behind the guard, and could edit files only on the lane that may write", () => {
    expect(flag(first?.argv ?? [], "--settings")).toMatch(/PreToolUse.*guard/s);
    expect(flag(first?.argv ?? [], "--allowedTools")).toMatch(/Edit/);
    expect(flag(second?.argv ?? [], "--allowedTools")).not.toMatch(/Edit/);
    expect(first?.env.FACTOR_ACCESS).toBe("write");
    expect(second?.env.FACTOR_ACCESS).toBe("read");
    expect(first?.env.FACTOR_WORKTREE).toBe(first?.cwd);
    expect(first?.argv).not.toContain("--bare");
    expect(first?.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("had its usage, cost and session id read from the result", () => {
    const lanes = repo.rows("select lane, tokens, usd from lane_runs order by id");
    expect(lanes[0]).toEqual({ lane: "build", tokens: 1350, usd: 0.42 });
    const state = JSON.parse(runRow(repo)?.state ?? "{}");
    expect(state.spent).toMatchObject({ tokens: 2700, usd: 0.84 });
    const events = repo.rows<{ data: string }>("select data from events where kind = 'lane.session'");
    expect(JSON.parse(events[0]?.data ?? "{}")).toMatchObject({
      lane: "build",
      account: "claude-a",
      agent: "claude",
      sessionId: "claude-session-1",
    });
  });
});

describe("a Claude run that goes wrong", () => {
  it("fails the lane when the result is an error", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    standinAccount(repo, "claude-a", "claude", { error: "The model returned an error." });
    bind(repo, "author", "claude-a");
    expect(repo.sf("run").status).toBe(1);
    expect(trail(repo)).toEqual(["build:fail"]);
    expect(repo.rows<{ note: string }>("select note from lane_runs")[0]?.note).toMatch(
      /model returned an error/,
    );
  });

  it("takes the hand-off from the last message when the agent wrote no file", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    const said = 'All done.\n\n```json\n{"outcome":"pass","summary":"Said, not written."}\n```\n';
    standinAccount(repo, "claude-a", "claude", { final: said });
    bind(repo, "author", "claude-a");
    expect(repo.sf("run").status).toBe(0);
    expect(repo.rows<{ note: string }>("select note from lane_runs")[0]?.note).toBe("Said, not written.");
  });

  it("is refused before it starts when its account is gone", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    standinAccount(repo, "claude-a", "claude", {});
    bind(repo, "author", "claude-a");
    repo.sf("account", "remove", "claude-a");
    const r = repo.sf("run");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/claude-a/);
    expect(repo.sf("status").stdout).not.toMatch(/running|stopped/);
  });
});
