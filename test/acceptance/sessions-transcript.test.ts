import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLane, bind, flowRepo, type Repo, runRow, standinAccount } from "../helpers/repo.ts";

const transcripts = (repo: Repo) => {
  const dir = join(repo.dir, ".factor/runs", runRow(repo)?.id ?? "", "sessions");
  try {
    return readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8"));
  } catch {
    return [];
  }
};

describe("a transcript the host cannot trust", () => {
  it("is not read through a link the agent put in its place", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    const secret = join(repo.home, "elsewhere.txt");
    writeFileSync(secret, '{"type":"result","result":"TOP-SECRET"}\n');
    const swap = `f="$FACTOR_LANE_DIR.host/stream.jsonl"; rm -f "$f"; ln -s '${secret}' "$f"`;
    standinAccount(repo, "claude-a", "claude", {
      actions: [{ sh: swap }, { handoff: { outcome: "pass", summary: "ok" } }],
    });
    bind(repo, "author", "claude-a");
    repo.sf("run");
    expect(transcripts(repo).join("")).not.toContain("TOP-SECRET");
    expect(
      repo.rows<{ transcript_path: string | null }>("select transcript_path from sessions")[0]
        ?.transcript_path,
    ).toBeNull();
  });

  it("is cut when it is larger than the cap, keeps its end, and says so", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    standinAccount(repo, "claude-a", "claude", {
      final: "x".repeat(20_000),
      actions: [{ handoff: { outcome: "pass", summary: "ok" } }],
    });
    bind(repo, "author", "claude-a");
    repo.env.FACTOR_TRANSCRIPT_MAX_BYTES = "4000";
    expect(repo.sf("run").status).toBe(0);
    const [transcript] = transcripts(repo);
    expect(transcript?.length).toBeLessThan(4200);
    expect(transcript).toMatch(/^\{"type":"factor\.cut"/);
    expect(transcript).toContain('"total_cost_usd":0.42'); // the result is at the end, and is kept
    expect(repo.rows<{ tokens: number }>("select tokens from sessions")[0]?.tokens).toBe(1350);
  });
});
