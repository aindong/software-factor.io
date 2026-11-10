import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLane, bind, flowRepo, runRow, standinAccount, trail } from "../helpers/repo.ts";

const HOUR = 3_600_000;
const pass = { actions: [{ handoff: { outcome: "pass", summary: "ok" } }] };

describe("an account near its limit", () => {
  it("holds the lane until the window has passed", () => {
    const repo = flowRepo({ lanes: [agentLane("a", { on: { pass: "b", fail: "@stop" } }), agentLane("b")] });
    // each stand-in run reports 1350 tokens: the first lane takes the account past 80% of 1500
    standinAccount(repo, "claude-a", "claude", pass, ["--limit", "5h=1500", "--headroom", "0.8"]);
    bind(repo, "author", "claude-a");
    const first = repo.sf("run");
    expect(first.status, first.stdout + first.stderr).toBe(3);
    expect(trail(repo)).toEqual(["a:pass"]);
    expect(runRow(repo)).toMatchObject({ status: "waiting", stop_code: "account_limit" });
    expect(runRow(repo)?.wake_at).toBeTruthy();
    expect(repo.sf("account", "list").stdout).toMatch(/claude-a.*held until/);

    repo.env.FACTOR_CLOCK_OFFSET_MS = String(2 * HOUR);
    repo.sf("run");
    expect(runRow(repo)?.status).toBe("waiting");

    repo.env.FACTOR_CLOCK_OFFSET_MS = String(5 * HOUR + 60_000);
    expect(repo.sf("run").status).toBe(0);
    expect(trail(repo)).toEqual(["a:pass", "b:pass"]);
  });

  it("does not hold an account that is under its limit", () => {
    const repo = flowRepo({ lanes: [agentLane("a", { on: { pass: "b", fail: "@stop" } }), agentLane("b")] });
    standinAccount(repo, "claude-a", "claude", pass, ["--limit", "5h=100000"]);
    bind(repo, "author", "claude-a");
    expect(repo.sf("run").status).toBe(0);
    expect(repo.sf("account", "list").stdout).not.toMatch(/held until/);
  });

  it("holds the account when its CLI says the limit is reached, and runs the lane again later", () => {
    const repo = flowRepo({ lanes: [agentLane("a")] });
    const limit = { error: "You have reached your usage limit. It resets at 5pm." };
    const profile = standinAccount(repo, "claude-a", "claude", limit);
    bind(repo, "author", "claude-a");
    expect(repo.sf("run").status).toBe(3);
    expect(runRow(repo)).toMatchObject({ status: "waiting", stop_code: "account_limit" });
    expect(repo.sf("account", "list").stdout).toMatch(/claude-a.*held until/);

    writeFileSync(join(profile.dir, "standin.json"), JSON.stringify(pass)); // the limit has reset
    repo.sf("run");
    expect(runRow(repo)?.status).toBe("waiting"); // not before the hold is over
    repo.env.FACTOR_CLOCK_OFFSET_MS = String(2 * HOUR);
    expect(repo.sf("run").status).toBe(0);
    expect(trail(repo)).toEqual(["a:pass"]);
    expect(profile.calls().length).toBe(2);
  });
});
