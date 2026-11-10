// `softwarefactor cost --check`: the report against the session rows, and each row against what
// the CLI itself printed, in the transcript the factory kept. To the token.
import { appendFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { printingAccount } from "../helpers/cost.ts";
import { agentLane, flowRepo, type Repo } from "../helpers/repo.ts";
import { sql } from "../helpers/runs.ts";

const result = (usage: Record<string, number>) => ({
  type: "result",
  is_error: false,
  result: "ok",
  session_id: "s",
  total_cost_usd: 0.1,
  usage,
});
const last = {
  input_tokens: 11,
  output_tokens: 7,
  cache_read_input_tokens: 5,
  cache_creation_input_tokens: 3,
};
function claudeRun(
  lines: unknown[] = [result({ input_tokens: 900, output_tokens: 900 }), result(last)],
): Repo {
  const repo = flowRepo({ lanes: [agentLane("build")] });
  printingAccount(repo, "claude", lines);
  repo.sf("run");
  return repo;
}
const row = (repo: Repo) =>
  repo.rows<{ run_id: string; transcript_path: string; input_tokens: number; cache_read_tokens: number }>(
    "select run_id, transcript_path, input_tokens, cache_read_tokens from sessions",
  )[0];
const change = (repo: Repo, set: string) => sql(repo, (db) => db.exec(`update sessions set ${set}`));

describe("cost --check", () => {
  it("passes on a Claude session, read from the last result the CLI printed, and says what it re-read", () => {
    const repo = claudeRun();
    expect(row(repo)).toMatchObject({ input_tokens: 11, cache_read_tokens: 5 });
    const r = repo.sf("cost", "--check");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/1 session on 1 lane/);
    expect(r.stdout).toMatch(/1 transcript re-read/);
    expect(r.stdout).toMatch(/matches.*to the token/i);
  });

  it("fails on a row changed by one token, with its total changed to fit, and names both numbers", () => {
    const repo = claudeRun();
    change(repo, "input_tokens = input_tokens + 1, tokens = tokens + 1");
    const r = repo.sf("cost", "--check");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(new RegExp(`run ${row(repo)?.run_id}, lane build.*12 input.*printed 11`));
    expect(r.stdout).not.toMatch(/to the token/);
  });

  it("fails on a row whose total is not the sum of its kinds", () => {
    const repo = claudeRun();
    change(repo, "tokens = tokens + 1");
    const r = repo.sf("cost", "--check");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/27.*kinds add up to 26/);
  });

  it("passes on a Codex session of two turns with cached input, and fails when its cache count is changed", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    printingAccount(repo, "codex", [
      { type: "thread.started", thread_id: "t" },
      { type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10 } },
      { type: "turn.completed", usage: { input_tokens: 50, cached_input_tokens: 20, output_tokens: 4 } },
    ]);
    repo.sf("run");
    expect(row(repo)).toMatchObject({ input_tokens: 50, cache_read_tokens: 100 });
    const ok = repo.sf("cost", "--check");
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
    expect(ok.stdout).toMatch(/1 transcript re-read/);
    change(repo, "cache_read_tokens = cache_read_tokens - 1, tokens = tokens - 1");
    const r = repo.sf("cost", "--check");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/99 cache read.*printed 100/);
  });

  it("fails on a transcript that was changed, is gone, is a link, or is named outside the run's folder", () => {
    const changed = claudeRun();
    const path = row(changed)?.transcript_path ?? "";
    appendFileSync(join(changed.dir, path), `${JSON.stringify(result({ ...last, input_tokens: 12 }))}\n`);
    change(changed, "input_tokens = 12, tokens = tokens + 1"); // the row and the file agree: the file is not the one kept
    const r1 = changed.sf("cost", "--check");
    expect(r1.status).toBe(1);
    expect(r1.stdout).toContain(path);
    expect(r1.stdout).toMatch(/not the file that was kept/);

    const gone = claudeRun();
    rmSync(join(gone.dir, row(gone)?.transcript_path ?? ""));
    const r2 = gone.sf("cost", "--check");
    expect(r2.status).toBe(1);
    expect(r2.stdout).toMatch(/is gone, or is not a plain file/);

    const linked = claudeRun();
    const file = join(linked.dir, row(linked)?.transcript_path ?? "");
    const elsewhere = join(linked.home, "elsewhere.jsonl");
    writeFileSync(elsewhere, `${JSON.stringify(result(last))}\n`);
    rmSync(file);
    symlinkSync(elsewhere, file);
    expect(linked.sf("cost", "--check").status).toBe(1);

    const outside = claudeRun();
    change(outside, "transcript_path = '../outside.jsonl'");
    const r4 = outside.sf("cost", "--check");
    expect(r4.status).toBe(1);
    expect(r4.stdout).toMatch(/outside its run's folder/);
  });

  it("re-reads a Claude transcript that was cut to its end, and still fails when that file is changed", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    repo.env.FACTOR_TRANSCRIPT_MAX_BYTES = "600";
    printingAccount(repo, "claude", [{ type: "system", pad: "x".repeat(3000) }, result(last)]);
    repo.sf("run");
    expect(repo.read(row(repo)?.transcript_path ?? "")).toMatch(/^\{"type":"factor\.cut"/);
    const ok = repo.sf("cost", "--check");
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
    expect(ok.stdout).toMatch(/1 transcript re-read/);
    appendFileSync(join(repo.dir, row(repo)?.transcript_path ?? ""), "\n");
    expect(repo.sf("cost", "--check").status).toBe(1);
  });

  it("counts a session of the scripted agent, which leaves no transcript, as not re-read", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    repo.sf("run");
    const r = repo.sf("cost", "--check");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/0 transcripts re-read, 1 with no transcript/);
  });

  it("has nothing to check in a workspace with no session", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    const r = repo.sf("cost", "--check");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/No sessions yet/);
  });
});
