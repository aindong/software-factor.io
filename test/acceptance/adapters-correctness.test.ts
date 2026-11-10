// Cases from the correctness review of task 10.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLane, bind, flowRepo, type Profile, runRow, standinAccount } from "../helpers/repo.ts";

const HOUR = 3_600_000;
const pass = { actions: [{ handoff: { outcome: "pass", summary: "ok" } }] };
const limit = "You have reached your usage limit.";
const plan = (profile: Profile, p: unknown) =>
  writeFileSync(join(profile.dir, "standin.json"), JSON.stringify(p));
const readLane = () => agentLane("look", { agent: { access: "read" } });

describe("a hold on an account in the middle of a lane", () => {
  it("gives the lane a person's answer again after the hold", () => {
    const repo = flowRepo({ lanes: [agentLane("a")] });
    const ask = { actions: [{ handoff: { outcome: "needsPerson", summary: "Which colour?" } }] };
    const profile = standinAccount(repo, "claude-a", "claude", ask);
    bind(repo, "author", "claude-a");
    expect(repo.sf("run").status).toBe(3);
    plan(profile, { error: limit });
    expect(repo.sf("answer", runRow(repo)?.id ?? "", "--note", "paint it blue").status).toBe(3);
    expect(runRow(repo)?.stop_code).toBe("account_limit");
    plan(profile, pass);
    repo.env.FACTOR_CLOCK_OFFSET_MS = String(2 * HOUR);
    expect(repo.sf("run").status).toBe(0);
    const calls = profile.calls();
    expect(calls[1]?.stdin).toContain("paint it blue");
    expect(calls[2]?.stdin, "the start after the hold").toContain("paint it blue");
  });

  it("drops what a read-only lane's agent committed before the limit, and still holds the account", () => {
    const repo = flowRepo({ lanes: [readLane()] });
    standinAccount(repo, "claude-a", "claude", {
      actions: [{ write: { path: "README.md", content: "changed\n" } }, { commit: "sneak" }],
      error: limit,
    });
    bind(repo, "author", "claude-a");
    expect(repo.sf("run").status).toBe(1); // changing the repository fails the lane, limit or not
    const [r] = repo.rows<{ branch: string; base_commit: string }>("select branch, base_commit from runs");
    expect(repo.git("rev-parse", r?.branch ?? ""), "the run's branch").toBe(r?.base_commit);
    expect(repo.sf("account", "list").stdout).toMatch(/held until/);
  });

  it("drops what a read-only lane's agent committed before its time was up", () => {
    const repo = flowRepo({
      lanes: [agentLane("look", { agent: { access: "read" }, limits: { minutes: 1 } })],
    });
    standinAccount(repo, "claude-a", "claude", {
      actions: [
        { write: { path: "README.md", content: "changed\n" } },
        { commit: "sneak" },
        { sleep: 20_000 },
      ],
    });
    bind(repo, "author", "claude-a");
    repo.env.FACTOR_MINUTE_MS = "1500";
    expect(repo.sf("run").status).toBe(1);
    const [r] = repo.rows<{ branch: string; base_commit: string }>("select branch, base_commit from runs");
    expect(repo.git("rev-parse", r?.branch ?? ""), "the run's branch").toBe(r?.base_commit);
  }, 30_000);
});

describe("a read-only lane whose agent switched branches", () => {
  it("does not move the other branch, and puts the run's branch back", () => {
    const repo = flowRepo({ lanes: [readLane()] });
    repo.git("branch", "other", "HEAD~1");
    const before = repo.git("rev-parse", "other");
    standinAccount(repo, "claude-a", "claude", {
      actions: [
        { write: { path: "README.md", content: "on the run's branch\n" } },
        { commit: "sneak" },
        { sh: "git checkout -q other && echo changed >> README.md" },
        { handoff: { outcome: "pass", summary: "ok" } },
      ],
    });
    bind(repo, "author", "claude-a");
    expect(repo.sf("run").status).toBe(1);
    expect(repo.git("rev-parse", "other"), "the user's branch").toBe(before);
    const [r] = repo.rows<{ branch: string; base_commit: string }>("select branch, base_commit from runs");
    expect(repo.git("rev-parse", r?.branch ?? ""), "the run's branch").toBe(r?.base_commit);
  });
});

describe("a Codex run that recovered", () => {
  it("is not failed for an error event that a finished turn follows", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    standinAccount(repo, "codex-a", "codex", {
      retried: "Reconnecting... 1/5",
      actions: [{ final: { outcome: "pass", summary: "Done after a retry." } }],
    });
    bind(repo, "author", "codex-a");
    const run = repo.sf("run");
    expect(run.status, run.stdout + run.stderr).toBe(0);
  });
});

describe("accounts, at the edges", () => {
  it("refuse a limit of no hours or no tokens, with a fix", () => {
    const repo = flowRepo({ lanes: [agentLane("a")] });
    for (const bad of ["0h=5", "5h=0"]) {
      const r = repo.sf("account", "add", "x", "--agent", "command", "--command", "true", "--limit", bad);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/fix:/);
    }
  });

  it("start clean when a name is removed and added again", () => {
    const repo = flowRepo({ lanes: [agentLane("a")] });
    standinAccount(repo, "claude-a", "claude", { error: limit });
    bind(repo, "author", "claude-a");
    expect(repo.sf("run").status).toBe(3);
    expect(repo.sf("account", "list").stdout).toMatch(/held until/);
    repo.sf("account", "remove", "claude-a");
    standinAccount(repo, "claude-a", "claude", pass);
    expect(repo.sf("account", "list").stdout).not.toMatch(/held until/);
  });
});
