import { describe, expect, it } from "vitest";
import { agentLane, bind, flag, flowRepo, standinAccount, trail } from "../helpers/repo.ts";

describe("a lane worked by Codex", () => {
  const repo = flowRepo({
    lanes: [
      agentLane("build", {
        agent: { access: "write", tier: "large", effort: "high" },
        gates: ["verify"],
        on: { pass: "review", fail: "@stop" },
      }),
      agentLane("review", { agent: { role: "reviewer", access: "read" } }),
    ],
  });
  // like the real CLI in its sandbox, the writer cannot commit: it leaves the change in the worktree
  const writer = standinAccount(repo, "codex-w", "codex", {
    actions: [
      { write: { path: "a.txt", content: "a\n" } },
      { final: { outcome: "pass", summary: "Built it." } },
    ],
  });
  const review = 'Here is my review.\n```json\n{"outcome":"pass","summary":"Looks right."}\n```';
  const reader = standinAccount(repo, "codex-r", "codex", { actions: [{ final: review }] });
  bind(repo, "author", "codex-w", "--large", "gpt-large");
  bind(repo, "reviewer", "codex-r");
  const run = repo.sf("run");
  const w = writer.calls()[0];
  const r = reader.calls()[0];

  it("finishes: the hand-off is taken from the final message", () => {
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(trail(repo)).toEqual(["build:pass", "review:pass"]);
    const notes = repo.rows<{ note: string }>("select note from lane_runs order by id").map((l) => l.note);
    expect(notes).toEqual(["Built it.", "Looks right."]);
  });

  it("has what the writer left uncommitted committed by the host, on the run's branch", () => {
    const [row] = repo.rows<{ branch: string }>("select branch from runs");
    expect(repo.git("ls-tree", "--name-only", row?.branch ?? "")).toContain("a.txt");
  });

  it("was started with exec and JSON events, on the worktree, under the account's profile", () => {
    const [row] = repo.rows<{ worktree: string }>("select worktree from runs");
    expect(w?.argv.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(flag(w?.argv ?? [], "-C")).toBe(row?.worktree);
    expect(w?.env.CODEX_HOME).toBe(writer.dir);
    expect(w?.stdin).toContain("Do the build step.");
  });

  it("was sandboxed by the lane's access, with no approval prompts", () => {
    expect(flag(w?.argv ?? [], "-s")).toBe("workspace-write");
    expect(flag(r?.argv ?? [], "-s")).toBe("read-only");
    expect(w?.argv.join(" ")).toContain('approval_policy="never"');
    expect(w?.env.OPENAI_API_KEY).toBeUndefined();
    expect(w?.env.CODEX_API_KEY).toBeUndefined();
  });

  it("got its model and effort", () => {
    expect(flag(w?.argv ?? [], "-m")).toBe("gpt-large");
    expect(w?.argv.join(" ")).toContain('model_reasoning_effort="high"');
    expect(r?.argv).not.toContain("-m"); // no model named for this tier: the CLI's own default
  });

  it("had its tokens and thread id read from the events", () => {
    expect(repo.rows("select lane, tokens from lane_runs order by id")).toEqual([
      { lane: "build", tokens: 2300 },
      { lane: "review", tokens: 2300 },
    ]);
    const events = repo.rows<{ data: string }>("select data from events where kind = 'lane.session'");
    expect(JSON.parse(events[0]?.data ?? "{}")).toMatchObject({
      agent: "codex",
      account: "codex-w",
      sessionId: "codex-thread-1",
    });
  });

  it("fails the lane when the turn fails", () => {
    const other = flowRepo({ lanes: [agentLane("build")] });
    standinAccount(other, "codex-a", "codex", { error: "stream disconnected" });
    bind(other, "author", "codex-a");
    expect(other.sf("run").status).toBe(1);
    expect(other.rows<{ note: string }>("select note from lane_runs")[0]?.note).toMatch(
      /stream disconnected/,
    );
  });
});
