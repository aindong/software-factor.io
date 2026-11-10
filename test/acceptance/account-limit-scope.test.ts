// Cases the plan's skeptic asked for: a hold must be on the right account, count from every
// workspace of this machine, and end exactly when the window has passed.
import { describe, expect, it } from "vitest";
import { agentLane, bind, flowRepo, runRow, standinAccount, trail } from "../helpers/repo.ts";

const HOUR = 3_600_000;
const MINUTE = 60_000;
const pass = { actions: [{ handoff: { outcome: "pass", summary: "ok" } }] };
const limited = ["--limit", "5h=1500", "--headroom", "0.8"]; // one stand-in run uses 1350 tokens

describe("a hold on an account", () => {
  const repo = flowRepo({
    lanes: [
      agentLane("a", { on: { pass: "b", fail: "@stop" } }),
      agentLane("b", { agent: { role: "reviewer" }, on: { pass: "c", fail: "@stop" } }),
      agentLane("c"),
    ],
  });
  standinAccount(repo, "claude-a", "claude", pass, limited);
  const other = standinAccount(repo, "claude-b", "claude", pass);
  bind(repo, "author", "claude-a");
  bind(repo, "reviewer", "claude-b");
  const started = Date.now();
  const first = repo.sf("run");

  it("holds only the lanes of that account", () => {
    expect(first.status, first.stdout + first.stderr).toBe(3);
    expect(trail(repo)).toEqual(["a:pass", "b:pass"]);
    expect(other.calls().length).toBe(1);
    expect(runRow(repo)).toMatchObject({ status: "waiting", stop_code: "account_limit" });
  });

  it("ends when the usage has left the window, not before", () => {
    const wake = Date.parse(runRow(repo)?.wake_at ?? "");
    expect(Math.abs(wake - (started + 5 * HOUR))).toBeLessThan(MINUTE);
    repo.env.FACTOR_CLOCK_OFFSET_MS = String(5 * HOUR - 2 * MINUTE);
    repo.sf("run");
    expect(runRow(repo)?.status).toBe("waiting");
  });

  it("counts for every workspace on this machine", () => {
    const second = flowRepo({ lanes: [agentLane("a")] });
    second.env.FACTOR_HOME = repo.home;
    bind(second, "author", "claude-a");
    expect(second.sf("run").status).toBe(3);
    expect(trail(second)).toEqual([]);
    expect(runRow(second)).toMatchObject({ status: "waiting", stop_code: "account_limit" });
  });

  it("lets the run go on once the window has passed", () => {
    repo.env.FACTOR_CLOCK_OFFSET_MS = String(5 * HOUR + MINUTE);
    expect(repo.sf("run").status).toBe(0);
    expect(trail(repo)).toEqual(["a:pass", "b:pass", "c:pass"]);
  });
});

describe("the edge of a limit", () => {
  it("holds an account that has used exactly its limit", () => {
    const repo = flowRepo({ lanes: [agentLane("a", { on: { pass: "b", fail: "@stop" } }), agentLane("b")] });
    standinAccount(repo, "claude-a", "claude", pass, ["--limit", "5h=1350", "--headroom", "1"]);
    bind(repo, "author", "claude-a");
    expect(repo.sf("run").status).toBe(3);
    expect(trail(repo)).toEqual(["a:pass"]);
  });

  it("holds a Codex account whose turn failed on its limit", () => {
    const repo = flowRepo({ lanes: [agentLane("a")] });
    standinAccount(repo, "codex-a", "codex", { error: "You've hit your usage limit. Try again later." });
    bind(repo, "author", "codex-a");
    expect(repo.sf("run").status).toBe(3);
    expect(runRow(repo)).toMatchObject({ status: "waiting", stop_code: "account_limit" });
  });
});
