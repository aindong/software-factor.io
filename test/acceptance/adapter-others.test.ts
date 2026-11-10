import { describe, expect, it } from "vitest";
import {
  agentLane,
  alive,
  background,
  bind,
  flag,
  flowRepo,
  runRow,
  standinAccount,
  trail,
  uniqueNap,
  until,
} from "../helpers/repo.ts";

describe("a lane worked by Kimi Code", () => {
  it("is started in print mode under the account's profile, and ends by its hand-off", () => {
    const repo = flowRepo({ lanes: [agentLane("build", { agent: { tier: "medium" } })] });
    const profile = standinAccount(repo, "kimi-a", "kimi", {
      actions: [{ handoff: { outcome: "pass", summary: "Kimi did it." } }],
    });
    bind(repo, "author", "kimi-a", "--medium", "kimi-k2");
    const run = repo.sf("run");
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(repo.rows<{ note: string }>("select note from lane_runs")[0]?.note).toBe("Kimi did it.");
    const call = profile.calls()[0];
    expect(call?.env.KIMI_CODE_HOME).toBe(profile.dir);
    expect(flag(call?.argv ?? [], "-p")).toContain("Do the build step.");
    expect(flag(call?.argv ?? [], "--output-format")).toBe("stream-json");
    expect(flag(call?.argv ?? [], "-m")).toBe("kimi-k2");
    expect(run.stdout).toMatch(/no guard/); // this CLI cannot run the guard, and the run says so
  });
});

describe("a lane worked by any command", () => {
  it("runs the account's command with the prompt in a file, and ends by its hand-off", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    const command =
      'grep -q "Do the build step." "$FACTOR_PROMPT_FILE" && echo \'{"outcome":"pass","summary":"The script did it."}\' > "$FACTOR_HANDOFF"';
    const add = repo.sf("account", "add", "script", "--agent", "command", "--command", command);
    expect(add.status, add.stderr).toBe(0);
    bind(repo, "author", "script");
    const run = repo.sf("run");
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(repo.rows<{ note: string }>("select note from lane_runs")[0]?.note).toBe("The script did it.");
  });

  it("needs a command line", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    const add = repo.sf("account", "add", "script", "--agent", "command");
    expect(add.status).toBe(1);
    expect(add.stderr).toMatch(/--command/);
  });
});

describe("stopping a real agent", () => {
  it("stops the CLI when the lane's time is up", () => {
    const repo = flowRepo({ lanes: [agentLane("build", { limits: { minutes: 1 } })] });
    standinAccount(repo, "claude-a", "claude", {
      actions: [{ sleep: 20_000 }, { handoff: { outcome: "pass", summary: "late" } }],
    });
    bind(repo, "author", "claude-a");
    repo.env.FACTOR_MINUTE_MS = "800";
    const started = Date.now();
    expect(repo.sf("run").status).toBe(1);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(trail(repo)).toEqual(["build:fail"]);
    expect(repo.rows<{ note: string }>("select note from lane_runs")[0]?.note).toMatch(/out of time/);
  }, 30_000);

  it("stops the CLI and what it started when a person stops the run", async () => {
    const nap = uniqueNap(60);
    const repo = flowRepo({ lanes: [agentLane("build")] });
    repo.sf("account", "add", "script", "--agent", "command", "--command", nap);
    bind(repo, "author", "script");
    const run = background(repo, "run");
    expect(await until(() => alive(nap))).toBe(true);
    expect(repo.sf("stop", runRow(repo)?.id ?? "").status).toBe(0);
    await run.exit;
    expect(alive(nap)).toBe(false);
    expect(runRow(repo)).toMatchObject({ status: "stopped", stop_code: "stopped_by_person" });
  }, 30_000);
});
