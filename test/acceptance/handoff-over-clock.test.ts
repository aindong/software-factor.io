// A lane whose agent handed off but whose process did not end: when the time runs out the hand-off
// still decides (docs/handoff.md, "When time runs out"), and nothing the agent started outlives the lane.
import { describe, expect, it } from "vitest";
import {
  agentLane,
  alive,
  bind,
  flowRepo,
  panelLane,
  runRow,
  standinAccount,
  standinAlive,
  trail,
  uniqueNap,
} from "../helpers/repo.ts";

const ok = { outcome: "pass", summary: "Built it." };
const noteOf = (repo: ReturnType<typeof flowRepo>) =>
  repo.rows<{ note: string }>("select note from lane_runs order by id")[0]?.note ?? "";
const gates = (repo: ReturnType<typeof flowRepo>) =>
  repo.rows<{ n: number }>("select count(*) as n from gate_results")[0]?.n;
const lane = (extra = {}) => agentLane("build", { limits: { minutes: 1 }, gates: ["verify"], ...extra });

/** A run whose agent hands off, starts `child`, and then does not end for 20 seconds. */
function lingering(actions: unknown[], agent = {}, laneExtra = {}) {
  const repo = flowRepo({ lanes: [lane(laneExtra)] });
  const profile = standinAccount(repo, "claude-a", "claude", { actions });
  bind(repo, "author", "claude-a");
  repo.env.FACTOR_MINUTE_MS = "800";
  return { repo, profile, ...agent };
}
const WRITE = { agent: { access: "write" } };

describe("a lane whose agent handed off and then did not end", () => {
  it("is judged by the hand-off, its gates run, and the record says the host ended the process", () => {
    const nap = uniqueNap(60);
    const { repo, profile } = lingering(
      [
        { write: { path: "a.txt", content: "a\n" } },
        { commit: "Add a" },
        { handoff: { ...ok, claims: [{ text: "a is there", evidence: ["file:a.txt"] }] } },
        { spawn: nap, inherit: true },
        { sleep: 20_000 },
      ],
      {},
      WRITE,
    );
    const started = Date.now();
    const run = repo.sf("run");
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(trail(repo)).toEqual(["build:pass"]);
    expect(noteOf(repo)).toMatch(/^Built it\. .*process did not end by itself.*the host ended it/);
    expect(gates(repo)).toBe(1);
    expect(repo.rows<{ n: number }>("select count(*) as n from claims")[0]?.n).toBe(1);
    expect(alive(nap)).toBe(false);
    expect(standinAlive(profile)).toBe(false);
  }, 30_000);

  it("keeps the outcome the agent gave: a fail is still a fail", () => {
    const { repo } = lingering([{ handoff: { outcome: "fail", summary: "Could not." } }, { sleep: 20_000 }]);
    expect(repo.sf("run").status).toBe(1);
    expect(noteOf(repo)).toMatch(/^Could not\./);
    expect(noteOf(repo)).not.toMatch(/out of time/);
  }, 30_000);

  it("is out of time when there is no hand-off, as before, and what it started is gone", () => {
    const nap = uniqueNap(60);
    const { repo } = lingering([{ spawn: nap, inherit: true }, { sleep: 20_000 }, { handoff: ok }]);
    expect(repo.sf("run").status).toBe(1);
    expect(noteOf(repo)).toMatch(/^out of time after 1 minutes/);
    expect(noteOf(repo)).not.toMatch(/did not end by itself.*the host ended it/);
    expect(gates(repo)).toBe(0);
    expect(alive(nap)).toBe(false);
  }, 30_000);

  it.each([
    ["malformed", { outcome: "pass" }],
    ["naming evidence that is not there", { ...ok, claims: [{ text: "x", evidence: ["file:nope.txt"] }] }],
  ])("is still rejected when the hand-off is %s", (_, handoff) => {
    const { repo } = lingering([{ handoff }, { sleep: 20_000 }]);
    expect(repo.sf("run").status).toBe(1);
    expect(noteOf(repo)).toMatch(/hand-off was rejected/);
    expect(trail(repo)).toEqual(["build:fail"]);
  }, 30_000);

  it("takes no hand-off from a process that is not the agent: a leftover that writes it after the cut", () => {
    // the agent leaves a child of its own process group that writes the file late; it is ended first
    const late = uniqueNap(60);
    const write = `${late}; printf '%s' '${JSON.stringify(ok)}' > "$FACTOR_HANDOFF"`;
    const { repo } = lingering([{ spawn: write, inherit: true, detached: true }, { sleep: 20_000 }]);
    expect(repo.sf("run").status).toBe(1);
    expect(noteOf(repo)).toMatch(/^out of time/);
    expect(alive(late)).toBe(false);
  }, 30_000);
});

describe("what a lane left running", () => {
  it("is ended after a pass, though the agent's process ended by itself", () => {
    const nap = uniqueNap(60);
    const repo = flowRepo({ lanes: [agentLane("build")] });
    standinAccount(repo, "claude-a", "claude", { actions: [{ spawn: nap, inherit: true }, { handoff: ok }] });
    bind(repo, "author", "claude-a");
    const started = Date.now();
    expect(repo.sf("run").status).toBe(0);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(alive(nap)).toBe(false);
  }, 30_000);

  it("is ended after a pass even when it left its process group", () => {
    const nap = uniqueNap(60);
    const { repo } = lingering([{ handoff: ok }, { spawn: nap, inherit: true, detached: true }, { sleep: 20_000 }]);
    expect(repo.sf("run").status).toBe(0);
    expect(alive(nap)).toBe(false);
  }, 30_000);

  it("is ended after a failed lane", () => {
    const nap = uniqueNap(60);
    const repo = flowRepo({ lanes: [agentLane("build")] });
    standinAccount(repo, "claude-a", "claude", {
      actions: [{ spawn: nap, inherit: true }, { handoff: { outcome: "fail", summary: "no" } }],
    });
    bind(repo, "author", "claude-a");
    expect(repo.sf("run").status).toBe(1);
    expect(alive(nap)).toBe(false);
  }, 30_000);
});

describe("a panel whose members handed off and did not end", () => {
  const members = [{ id: "logic" }, { id: "needs" }];
  const handoff = { mcp: { tool: "handoff_write", args: { handoff: ok } } };

  it("is judged by the members' hand-offs", () => {
    const nap = uniqueNap(60);
    const repo = flowRepo({ lanes: [panelLane(members, { limits: { minutes: 1 } })] });
    standinAccount(repo, "claude-r", "claude", {
      actions: [handoff, { spawn: nap, inherit: true }, { sleep: 20_000 }],
    });
    bind(repo, "reviewer", "claude-r");
    repo.env.FACTOR_MINUTE_MS = "1500";
    const run = repo.sf("run");
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(trail(repo)).toEqual(["review:pass"]);
    expect(noteOf(repo)).toMatch(/did not end by itself.*the host ended it/);
    expect(alive(nap)).toBe(false);
  }, 30_000);

  it("is out of time when a member left nothing", () => {
    const repo = flowRepo({ lanes: [panelLane(members, { limits: { minutes: 1 } })] });
    standinAccount(repo, "claude-r", "claude", { actions: [{ sleep: 20_000 }] });
    bind(repo, "reviewer", "claude-r");
    repo.env.FACTOR_MINUTE_MS = "1500";
    expect(repo.sf("run").status).toBe(1);
    expect(noteOf(repo)).toMatch(/out of time/);
  }, 30_000);
});

describe("a read-only lane", () => {
  it("is judged by its hand-off as a lane that writes is", () => {
    const repo = flowRepo({ lanes: [lane({ agent: { access: "read" } })] });
    standinAccount(repo, "claude-a", "claude", { actions: [{ handoff: ok }, { sleep: 20_000 }] });
    bind(repo, "author", "claude-a");
    repo.env.FACTOR_MINUTE_MS = "800";
    expect(repo.sf("run").status).toBe(0);
    expect(runRow(repo)?.status).toBe("done");
    expect(noteOf(repo)).toMatch(/did not end by itself.*the host ended it/);
  }, 30_000);
});
