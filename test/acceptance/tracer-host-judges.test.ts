import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { passingScript, readyRepo } from "../helpers/repo.ts";

describe("the host judges, on a fresh checkout", () => {
  it("fails a lane whose agent says pass but left the proof uncommitted", () => {
    const repo = readyRepo({
      verify: "test -f proof.txt",
      script: [
        { write: { path: "proof.txt", content: "x\n" } },
        { handoff: { outcome: "pass", summary: "Done." } },
      ],
    });
    const run = repo.sf("run");
    expect(run.status, run.stdout + run.stderr).toBe(1);
    expect(repo.rows("select gate, exit_code, status from gate_results")).toEqual([
      { gate: "verify", exit_code: 1, status: "fail" },
    ]);
    expect(repo.rows("select lane, outcome from lane_runs")).toEqual([{ lane: "work", outcome: "fail" }]);
    expect(repo.rows("select status from runs")).toEqual([{ status: "stopped" }]);
    expect(repo.rows("select status from tasks")).toEqual([{ status: "stopped" }]);
    // the proof really was in the agent's worktree: the gate did not look there
    const [r] = repo.rows<{ worktree: string }>("select worktree from runs");
    expect(existsSync(join(r?.worktree ?? "", "proof.txt"))).toBe(true);
    const status = repo.sf("status").stdout;
    expect(status).toMatch(/stopped/);
    expect(status).toMatch(/work\s.*fail/);
    expect(status).toMatch(/verify\s.*fail/);
  });

  it("ignores an agent that rewrites the gate's command in its own commit", () => {
    const repo = readyRepo({
      verify: "test -f proof.txt",
      script: [
        {
          write: {
            path: ".factor/factory.json",
            content: '{"version":1,"workflow":"starter","commands":{"verify":"true"}}\n',
          },
        },
        { commit: "Make the gate easy" },
        { handoff: { outcome: "pass", summary: "Done." } },
      ],
    });
    expect(repo.sf("run").status).toBe(1);
    expect(repo.rows("select command, status from gate_results")).toEqual([
      { command: "test -f proof.txt", status: "fail" },
    ]);
  });

  it("passes the same lane when the proof is committed", () => {
    const repo = readyRepo({
      verify: "test -f proof.txt",
      script: [
        { write: { path: "proof.txt", content: "x\n" } },
        { commit: "Add the proof" },
        { handoff: { outcome: "pass", summary: "Done." } },
      ],
    });
    expect(repo.sf("run").status).toBe(0);
    expect(repo.rows("select status from gate_results")).toEqual([{ status: "pass" }]);
  });

  it("fails a lane whose agent says fail even when the gate passes", () => {
    const repo = readyRepo({
      verify: "true",
      script: [{ handoff: { outcome: "fail", summary: "I could not do it." } }],
    });
    expect(repo.sf("run").status).toBe(1);
    expect(repo.rows("select outcome from lane_runs")).toEqual([{ outcome: "fail" }]);
  });

  it("fails a lane whose agent leaves no hand-off", () => {
    const repo = readyRepo({
      verify: "true",
      script: [{ write: { path: "a.txt", content: "a" } }, { commit: "a" }],
    });
    expect(repo.sf("run").status).toBe(1);
    expect(repo.rows("select outcome from lane_runs")).toEqual([{ outcome: "fail" }]);
  });
});

describe("a lane a person must approve", () => {
  it("stops as waiting with an inbox item, and marks nothing done", () => {
    const repo = readyRepo({ verify: "test -s hello.txt", script: passingScript });
    const workflow = repo.json<{ lanes: { checkpoint: string }[] }>(".factor/workflows/starter.json");
    const lane = workflow.lanes[0];
    if (lane) lane.checkpoint = "in";
    repo.write(".factor/workflows/starter.json", `${JSON.stringify(workflow, null, 2)}\n`);
    const run = repo.sf("run");
    expect(run.status, run.stdout + run.stderr).toBe(3);
    expect(repo.rows("select status from runs")).toEqual([{ status: "waiting" }]);
    expect(repo.rows("select status from tasks")).toEqual([{ status: "waiting" }]);
    expect(repo.rows("select kind, status, lane from inbox")).toEqual([
      { kind: "approval", status: "open", lane: "work" },
    ]);
    expect(repo.rows("select status from gate_results")).toEqual([{ status: "pass" }]);
  });
});
