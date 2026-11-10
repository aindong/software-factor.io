// From the review of task 11: output a CLI should never print, and files that are not what they
// seem. The record must stay whole and the run must not crash after tokens were spent.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLane, bind, flowRepo, type Repo, runRow, standinAccount } from "../helpers/repo.ts";

const ok = { handoff: { outcome: "pass", summary: "ok" } };
/** An account whose CLI prints exactly these lines, whatever it is asked. */
function oddAccount(repo: Repo, kind: "claude" | "codex", lines: unknown[]): void {
  const profile = join(repo.home, "profiles", "odd");
  mkdirSync(profile, { recursive: true });
  const bin = join(repo.home, "odd-cli");
  const print = lines.map((l) => `printf '%s\\n' '${JSON.stringify(l)}'`).join("\n");
  writeFileSync(bin, `#!/bin/sh\ncat > /dev/null\n${print}\n`, { mode: 0o755 });
  const added = repo.sf("account", "add", "odd", "--agent", kind, "--profile", profile, "--bin", bin);
  if (added.status !== 0) throw new Error(added.stderr);
  bind(repo, "author", "odd", ...(kind === "codex" ? ["--medium", "gpt-5.3-codex"] : []));
}
const result = (extra: Record<string, unknown>) => ({
  type: "result",
  is_error: false,
  result: "ok",
  session_id: "s",
  total_cost_usd: 0.1,
  usage: { input_tokens: 5, output_tokens: 5 },
  ...extra,
});
const sums = (repo: Repo) => ({
  sessions: repo.rows<{ n: number }>("select coalesce(sum(tokens), 0) as n from sessions")[0]?.n,
  lanes: repo.rows<{ n: number }>("select coalesce(sum(tokens), 0) as n from lane_runs")[0]?.n,
  spent: JSON.parse(runRow(repo)?.state ?? "{}").spent.tokens,
});

describe("numbers a CLI should never print", () => {
  it.each([
    ["negative", { input_tokens: -1_000_000, output_tokens: 5 }],
    ["not whole", { input_tokens: 1.5, output_tokens: 5 }],
    ["not a number", { input_tokens: "many", output_tokens: 5 }],
  ])("are not counted when they are %s", (_name, usage) => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    oddAccount(repo, "claude", [result({ usage })]);
    repo.sf("run");
    expect(repo.rows("select input_tokens, tokens from sessions")).toEqual([{ input_tokens: 0, tokens: 5 }]);
  });

  it("do not make a cost: a negative cost is unknown", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    oddAccount(repo, "claude", [result({ total_cost_usd: -5 })]);
    repo.sf("run");
    expect(repo.rows("select usd, usd_source from sessions")).toEqual([{ usd: null, usd_source: "unknown" }]);
  });

  it("do not crash the run when the list of models is not what it should be", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    oddAccount(repo, "claude", [result({ modelUsage: { a: null, b: null } })]);
    repo.sf("run");
    expect(repo.rows("select tokens from sessions")).toEqual([{ tokens: 10 }]);
    expect(runRow(repo)?.stop_code).not.toBe("crashed");
  });

  it("never give Codex a negative input when its cached counts pass its input", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    const usage = {
      input_tokens: 100,
      cached_input_tokens: 80,
      cache_write_input_tokens: 50,
      output_tokens: 10,
    };
    oddAccount(repo, "codex", [
      { type: "thread.started", thread_id: "t" },
      { type: "turn.completed", usage },
    ]);
    repo.sf("run");
    const [row] = repo.rows<Record<string, number>>("select * from sessions");
    expect(row?.input_tokens).toBe(0);
    expect(row?.tokens).toBe(
      (row?.cache_read_tokens ?? 0) + (row?.cache_write_tokens ?? 0) + (row?.output_tokens ?? 0),
    );
    expect(row?.usd).toBeGreaterThan(0);
  });
});

describe("the record when something breaks after the agent ended", () => {
  it("keeps the lane's totals equal to its sessions when a file sits where the hand-off is kept", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    const plant = `d='${repo.dir}'/.factor/runs/$FACTOR_RUN_ID/handoffs; mkdir -p "$d"; echo '{}' > "$d/01-build.json"`;
    standinAccount(repo, "claude-a", "claude", { actions: [{ sh: plant }, ok] });
    bind(repo, "author", "claude-a");
    expect(repo.sf("run").status).toBe(1);
    expect(sums(repo)).toEqual({ sessions: 1350, lanes: 1350, spent: 1350 });
    expect(runRow(repo)?.stop_code).not.toBe("crashed"); // the lane fails: the run did not break
  });

  it("keeps them equal when the run does crash", () => {
    const repo = flowRepo({ lanes: [agentLane("build", { limits: { repairRounds: 1 } })] });
    // the second start's prompt cannot be saved: a file is already in its place
    const plant = `d='${repo.dir}'/.factor/runs/$FACTOR_RUN_ID/prompts; echo x > "$d/01-build.2.md"`;
    standinAccount(repo, "claude-a", "claude", {
      actions: [{ sh: plant }, { handoff: { outcome: "pass" } }],
    });
    bind(repo, "author", "claude-a");
    expect(repo.sf("run").status).toBe(1);
    expect(runRow(repo)?.stop_code).toBe("crashed");
    expect(sums(repo)).toEqual({ sessions: 1350, lanes: 1350, spent: 1350 });
  });

  it("still records the session when prices.json breaks while the agent works", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    const breakIt = `echo '{' > '${join(repo.home, "prices.json")}'`;
    standinAccount(repo, "codex-a", "codex", {
      actions: [{ sh: breakIt }, { final: { outcome: "pass", summary: "ok" } }],
    });
    bind(repo, "author", "codex-a", "--medium", "gpt-5.3-codex");
    const run = repo.sf("run");
    expect(repo.rows("select tokens, usd, usd_source from sessions")).toEqual([
      { tokens: 2300, usd: null, usd_source: "unknown" },
    ]);
    expect(run.stdout).toMatch(/prices/);
  });

  it("does not read the transcript through a hard link the agent put in its place", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    const secret = join(repo.home, "elsewhere.txt");
    const forged = { ...result({ result: "TOP-SECRET", session_id: "LEAK", total_cost_usd: 9 }) };
    writeFileSync(secret, `${JSON.stringify(forged)}\n`);
    const swap = `f="$FACTOR_LANE_DIR.host/stream.jsonl"; rm -f "$f"; ln '${secret}' "$f"`;
    standinAccount(repo, "claude-a", "claude", { actions: [{ sh: swap }, ok] });
    bind(repo, "author", "claude-a");
    repo.sf("run");
    const [session] = repo.rows<Record<string, unknown>>("select * from sessions");
    expect(session).toMatchObject({ tokens: 0, usd: null, session_id: null, transcript_path: null });
  });
});

describe("softwarefactor sessions", () => {
  it("prints unknown as a run's total when no session of it has a cost", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    standinAccount(repo, "codex-a", "codex", { actions: [{ final: { outcome: "pass", summary: "ok" } }] });
    bind(repo, "author", "codex-a");
    repo.sf("run");
    expect(repo.sf("sessions").stdout).toMatch(/total\s+1400\s+300\s+500\s+100\s+unknown/);
  });
});
