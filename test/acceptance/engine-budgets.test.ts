import { describe, expect, it } from "vitest";
import { agentLane, flowRepo, pass, runRow, trail } from "../helpers/repo.ts";

describe("limits", () => {
  it("stop an agent that works past its lane's minutes, and fail the lane", () => {
    const repo = flowRepo({
      lanes: [agentLane("slow", { limits: { minutes: 1 } })],
      scripts: { author: { slow: [{ sleep: 5000 }, pass()] } },
    });
    repo.env.FACTOR_MINUTE_MS = "150"; // test hook: one minute lasts 150 ms
    const started = Date.now();
    expect(repo.sf("run").status).toBe(1);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(trail(repo)).toEqual(["slow:fail"]);
    expect(repo.rows<{ note: string }>("select note from lane_runs")[0]?.note).toMatch(/out of time/);
  });

  it("stop the run before a lane starts once the token budget is spent", () => {
    const spend = [{ usage: { tokens: 600 } }, pass()];
    const repo = flowRepo({
      limits: { minutes: 60, tokens: 1000 },
      lanes: [
        agentLane("a", { on: { pass: "b", fail: "@stop" } }),
        agentLane("b", { on: { pass: "c", fail: "@stop" } }),
        agentLane("c"),
      ],
      scripts: { author: { "*": spend } },
    });
    expect(repo.sf("run").status).toBe(1);
    expect(trail(repo)).toEqual(["a:pass", "b:pass"]);
    expect(runRow(repo)).toMatchObject({ status: "stopped", stop_code: "budget_tokens" });
    expect(repo.rows("select sum(tokens) as tokens from lane_runs")).toEqual([{ tokens: 1200 }]);
  });
});

describe("an agent past its time", () => {
  it("is stopped, not left working while the run moves on", async () => {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { commandLane } = await import("../helpers/repo.ts");
    const repo = flowRepo({
      lanes: [
        agentLane("slow", {
          agent: { access: "write" },
          gates: ["verify"],
          limits: { minutes: 1 },
          on: { pass: "@done", fail: "after" },
        }),
        commandLane("after", "sleep 1", { on: { pass: "@stop", fail: "@stop" } }),
      ],
      scripts: { author: { slow: [{ sleep: 600 }, { write: { path: "late.txt", content: "x" } }, pass()] } },
    });
    repo.env.FACTOR_MINUTE_MS = "150";
    expect(repo.sf("run").status).toBe(1);
    expect(trail(repo)).toEqual(["slow:fail", "after:pass"]);
    const [r] = repo.rows<{ worktree: string }>("select worktree from runs");
    expect(existsSync(join(r?.worktree ?? "", "late.txt"))).toBe(false);
  });
});
