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
  });
});
