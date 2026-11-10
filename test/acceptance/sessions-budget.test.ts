import { describe, expect, it } from "vitest";
import { agentLane, bind, flowRepo, runRow, standinAccount, trail } from "../helpers/repo.ts";

describe("a limit in dollars", () => {
  it("counts the priced cost of lanes worked by Codex", () => {
    const repo = flowRepo({
      lanes: [agentLane("a", { on: { pass: "b", fail: "@stop" } }), agentLane("b")],
      limits: { minutes: 60, tokens: 1_000_000, usd: 0.005 }, // one stand-in run prices at 0.0069 dollars
    });
    standinAccount(repo, "codex-a", "codex", { actions: [{ final: { outcome: "pass", summary: "ok" } }] });
    bind(repo, "author", "codex-a", "--medium", "gpt-5.3-codex");
    expect(repo.sf("run").status).toBe(1);
    expect(trail(repo)).toEqual(["a:pass"]);
    expect(runRow(repo)?.stop_code).toBe("budget_usd");
    const spent = JSON.parse(runRow(repo)?.state ?? "{}").spent.usd;
    expect(spent).toBeCloseTo(0.0069125, 9);
    expect(repo.rows<{ usd: number }>("select sum(usd) as usd from sessions")[0]?.usd).toBe(spent);
    expect(repo.rows<{ usd: number }>("select sum(usd) as usd from lane_runs")[0]?.usd).toBe(spent);
  });

  it("is not reached by a cost that is unknown, and the run says that it was not counted", () => {
    const repo = flowRepo({
      lanes: [agentLane("a", { on: { pass: "b", fail: "@stop" } }), agentLane("b")],
      limits: { minutes: 60, tokens: 1_000_000, usd: 0.005 },
    });
    standinAccount(repo, "codex-a", "codex", { actions: [{ final: { outcome: "pass", summary: "ok" } }] });
    bind(repo, "author", "codex-a"); // no model named
    const run = repo.sf("run");
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/cost of this session is unknown.*not counted/);
  });
});
