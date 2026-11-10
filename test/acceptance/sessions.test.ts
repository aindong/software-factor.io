import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLane, bind, flowRepo, standinAccount } from "../helpers/repo.ts";

describe("the session record of a lane worked by Claude Code", () => {
  const repo = flowRepo({ lanes: [agentLane("build")] });
  standinAccount(repo, "claude-a", "claude", { actions: [{ handoff: { outcome: "pass", summary: "ok" } }] });
  bind(repo, "author", "claude-a");
  const run = repo.sf("run");
  const rows = repo.rows<Record<string, unknown>>("select * from sessions order by id");
  const [session] = rows;

  it("is one row for the one start of the agent", () => {
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(rows.length).toBe(1);
    const [lane] = repo.rows<{ id: number; run_id: string }>("select id, run_id from lane_runs");
    expect(session).toMatchObject({ lane: "build", try: 1, lane_run_id: lane?.id, run_id: lane?.run_id });
  });

  it("says who worked, on which model, in which session of the CLI", () => {
    expect(session).toMatchObject({
      account: "claude-a",
      agent: "claude",
      model: "claude-standin-1",
      session_id: "claude-session-1",
    });
  });

  it("holds the tokens by kind and the cost, as the CLI reported them", () => {
    expect(session).toMatchObject({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 1000,
      cache_write_tokens: 200,
      tokens: 1350,
      usd: 0.42,
      usd_source: "reported",
    });
  });

  it("keeps the CLI's output as a transcript the factory owns, with its hash", () => {
    const path = String(session?.transcript_path);
    expect(path).toMatch(/^\.factor\/runs\/[0-9a-f]+\/sessions\/01-build\.jsonl$/);
    const transcript = readFileSync(join(repo.dir, path));
    expect(transcript.toString()).toContain('"type":"result"');
    expect(createHash("sha256").update(transcript).digest("hex")).toBe(session?.transcript_sha256);
  });
});
