import { describe, expect, it } from "vitest";
import { agentLane, bind, flowRepo, pass, type Repo, runRow, standinAccount } from "../helpers/repo.ts";

const sums = (repo: Repo) => ({
  sessions: repo.rows<{ n: number }>("select coalesce(sum(tokens), 0) as n from sessions")[0]?.n,
  lanes: repo.rows<{ n: number }>("select coalesce(sum(tokens), 0) as n from lane_runs")[0]?.n,
  spent: JSON.parse(runRow(repo)?.state ?? "{}").spent.tokens,
});

describe("sessions and the lane's totals", () => {
  it("are one session for each start of the agent, also for the scripted agent", () => {
    const repo = flowRepo({
      lanes: [agentLane("build", { retry: { max: 1 } })],
      scripts: {
        author: {
          build: [
            [{ usage: { tokens: 100, usd: 0.01 } }, { exit: 1 }],
            [{ usage: { tokens: 50 } }, pass()],
          ],
        },
      },
    });
    expect(repo.sf("run").status).toBe(0);
    const sessions = repo.rows(
      "select lane, try, agent, account, tokens, usd, usd_source from sessions order by id",
    );
    expect(sessions).toEqual([
      { lane: "build", try: 1, agent: "fake", account: null, tokens: 100, usd: 0.01, usd_source: "reported" },
      { lane: "build", try: 2, agent: "fake", account: null, tokens: 50, usd: 0, usd_source: "reported" },
    ]);
    expect(sums(repo)).toEqual({ sessions: 150, lanes: 150, spent: 150 });
  });

  it("add up to the lane runs and to what the run spent, to the token", () => {
    const repo = flowRepo({
      lanes: [
        agentLane("a", { on: { pass: "b", fail: "@stop" } }),
        agentLane("b", { agent: { role: "reviewer" }, on: { pass: "c", fail: "@stop" } }),
        agentLane("c"),
      ],
    });
    standinAccount(repo, "claude-a", "claude", {
      actions: [{ handoff: { outcome: "pass", summary: "ok" } }],
    });
    standinAccount(repo, "codex-a", "codex", { actions: [{ final: { outcome: "pass", summary: "ok" } }] });
    bind(repo, "author", "claude-a");
    bind(repo, "reviewer", "codex-a");
    expect(repo.sf("run").status).toBe(0);
    expect(sums(repo)).toEqual({ sessions: 5000, lanes: 5000, spent: 5000 }); // 1350 + 2300 + 1350
    const perLane = repo.rows(
      "select l.lane, l.tokens as lane, sum(s.tokens) as sessions from lane_runs l join sessions s on s.lane_run_id = l.id group by l.id order by l.id",
    );
    expect(perLane).toEqual([
      { lane: 1350, sessions: 1350 },
      { lane: 2300, sessions: 2300 },
      { lane: 1350, sessions: 1350 },
    ]);
  });
});
