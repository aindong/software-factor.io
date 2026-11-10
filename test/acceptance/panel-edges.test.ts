import { describe, expect, it } from "vitest";
import {
  alive,
  bind,
  flowRepo,
  panelLane,
  pass,
  runRow,
  sessionRows,
  standinAccount,
  standinAlive,
  uniqueNap,
} from "../helpers/repo.ts";

const two = [{ id: "logic" }, { id: "needs" }];
const noteOf = (repo: ReturnType<typeof flowRepo>) =>
  repo.rows<{ note: string }>("select note from lane_runs")[0]?.note ?? "";

describe("a panel member that does not give a verdict", () => {
  it("asks a person: the run waits with its question, and says who asked", () => {
    const ask = { handoff: { outcome: "needsPerson", summary: "Which colour should it be?" } };
    const repo = flowRepo({
      lanes: [panelLane(two)],
      scripts: { reviewer: { "review.logic": [ask], "review.needs": [pass()] } },
    });
    expect(repo.sf("run").status).toBe(3);
    expect(runRow(repo)?.stop_code).toBe("needs_person");
    expect(repo.sf("inbox").stdout).toMatch(/logic.*Which colour should it be\?/);
  });

  it("left a hand-off the host rejects: the lane fails and names the member", () => {
    const bad = { handoff: { outcome: "pass" } };
    const repo = flowRepo({
      lanes: [panelLane(two)],
      scripts: { reviewer: { "review.logic": [bad], "review.needs": [pass()] } },
    });
    expect(repo.sf("run").status).toBe(1);
    expect(noteOf(repo)).toMatch(/logic: fail.*hand-off was rejected/);
  });

  it("left no hand-off: the lane fails and names the member", () => {
    const silent = [{ usage: { tokens: 1 } }];
    const repo = flowRepo({
      lanes: [panelLane(two)],
      scripts: { reviewer: { "review.logic": silent, "review.needs": [pass()] } },
    });
    expect(repo.sf("run").status).toBe(1);
    expect(noteOf(repo)).toMatch(/logic: fail.*no hand-off/);
  });

  it("passes for an advising member that left nothing, and reports it", () => {
    const members = [...two, { id: "style", advisory: true }];
    const repo = flowRepo({
      lanes: [panelLane(members)],
      scripts: { reviewer: { "*": [pass()], "review.style": [{ exit: 3 }] } },
    });
    expect(repo.sf("run").status).toBe(0);
    expect(noteOf(repo)).toMatch(/style \(advises\): fail/);
  });
});

describe("a panel whose time is up", () => {
  it("stops every member and what it started", () => {
    const nap = uniqueNap(60);
    const repo = flowRepo({ lanes: [panelLane(two, { limits: { minutes: 1 } })] });
    const profile = standinAccount(repo, "claude-r", "claude", {
      actions: [{ spawn: nap }, { sleep: 20_000 }, { handoff: { outcome: "pass", summary: "late" } }],
    });
    bind(repo, "reviewer", "claude-r");
    repo.env.FACTOR_MINUTE_MS = "1500";
    const started = Date.now();
    expect(repo.sf("run").status).toBe(1);
    expect(Date.now() - started).toBeLessThan(12_000);
    expect(noteOf(repo)).toMatch(/out of time/);
    expect(alive(nap)).toBe(false);
    expect(standinAlive(profile)).toBe(false);
    expect(sessionRows(repo).length).toBe(2); // each member's start is still on the record
  }, 30_000);
});
