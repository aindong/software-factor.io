import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentLane,
  bind,
  callTool,
  flowRepo,
  mcpOf,
  runRow,
  standinAccount,
  trail,
} from "../helpers/repo.ts";

const start = (actions: unknown[]) => {
  const repo = flowRepo({ lanes: [agentLane("look", { agent: { access: "read" } })] });
  const profile = standinAccount(repo, "claude-a", "claude", { actions });
  bind(repo, "author", "claude-a");
  const run = repo.sf("run");
  return { repo, profile, run, note: repo.rows<{ note: string }>("select note from lane_runs")[0]?.note };
};
const tool = (name: string, args: Record<string, unknown>) => ({ mcp: { tool: name, args } });

describe("what an agent can do through the server", () => {
  it("hands off, also from a lane that has no tool to write a file", () => {
    const { run, note } = start([
      tool("handoff_write", { handoff: { outcome: "pass", summary: "Through the server." } }),
    ]);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(note).toBe("Through the server.");
  });

  it("has its hand-off checked by the host like any other", () => {
    const { run, note } = start([
      tool("handoff_write", { handoff: { outcome: "pass", summary: "x", verdict: "trust me" } }),
    ]);
    expect(run.status).toBe(1);
    expect(note).toMatch(/hand-off was rejected/);
  });

  it("asks a person, which parks the run", () => {
    const { repo, run } = start([tool("ask_question", { question: "Which colour should the button be?" })]);
    expect(run.status).toBe(3);
    expect(runRow(repo)?.stop_code).toBe("needs_person");
    expect(repo.sf("inbox").stdout).toContain("Which colour should the button be?");
  });

  it("attaches evidence a claim can cite", () => {
    const claims = [{ text: "The page loads.", evidence: ["attached:notes.txt"] }];
    const { repo, run } = start([
      tool("evidence_attach", { name: "notes.txt", text: "seen at 10:00" }),
      tool("handoff_write", { handoff: { outcome: "pass", summary: "ok", claims } }),
    ]);
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(trail(repo)).toEqual(["look:pass"]);
    const kept = join(repo.dir, ".factor/runs", runRow(repo)?.id ?? "", "evidence");
    expect(readFileSync(join(kept, "notes.txt"), "utf8")).toBe("seen at 10:00");
  });

  it("refuses an attachment that is not a plain file name, or too large", () => {
    const { profile } = start([
      tool("evidence_attach", { name: "../escape.txt", text: "x" }),
      tool("evidence_attach", { name: "big.txt", text: "x".repeat(1_100_000) }),
      tool("handoff_write", { handoff: { outcome: "pass", summary: "ok" } }),
    ]);
    const [escape, big] = mcpOf(profile);
    expect(escape?.answer?.result?.isError).toBe(true);
    expect(big?.answer?.result?.isError).toBe(true);
  });

  it("does not write a hand-off through a link left in its place", () => {
    const repo = flowRepo({ lanes: [agentLane("look")] });
    const laneDir = join(repo.home, "lane-x");
    const target = join(repo.home, "target.json");
    const lane = { run: "r1", lane: "look", laneDir };
    callTool(repo, lane, "evidence_attach", { name: "a.txt", text: "x" }); // makes the folder
    symlinkSync(target, join(laneDir, "handoff.json"));
    callTool(repo, lane, "handoff_write", { handoff: { outcome: "pass", summary: "ok" } });
    expect(existsSync(target)).toBe(false);
  });
});
