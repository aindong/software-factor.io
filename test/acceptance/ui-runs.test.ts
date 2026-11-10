import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jsonOf, startUi, type Ui } from "../helpers/repo.ts";
import { sql, threeRuns } from "../helpers/runs.ts";

interface Row {
  id: string;
  task: string;
  workflow: string;
  status: string;
  stopCode: string | null;
  startedAt: string;
  endedAt: string | null;
  visits: { lane: string; outcome: string | null }[];
  at: string | null;
  sentence: string;
  tokens: number;
  usd: number;
  usdUnknown: boolean;
}
const { repo, done, stopped, waiting } = threeRuns();
let ui: Ui;
let runs: Row[];
beforeAll(async () => {
  ui = await startUi(repo);
  runs = (await jsonOf<{ runs: Row[] }>(await ui.api("/api/runs"))).runs;
}, 120_000);
afterAll(() => ui?.stop());
const by = (id: string) => runs.find((r) => r.id === id) as Row;
const trail = (r: Row) => r.visits.map((v) => `${v.lane}:${v.outcome}`).join(" ");

describe("the list of runs", () => {
  it("is refused without the token", async () => {
    expect((await fetch(`${ui.url}/api/runs`)).status).toBe(401);
    expect((await ui.api("/api/runs", { headers: { "x-factor-token": "0".repeat(48) } })).status).toBe(401);
  });

  it("holds every run, the newest first, with its task and workflow", () => {
    expect(runs.map((r) => r.id)).toEqual([waiting, stopped, done]);
    expect(runs.map((r) => r.task)).toEqual(["Third task", "Second task", "First task"]);
    expect(new Set(runs.map((r) => r.workflow))).toEqual(new Set(["starter"]));
    for (const r of runs) expect(Number.isNaN(Date.parse(r.startedAt)), r.startedAt).toBe(false);
  });

  it("gives the lanes each run went through, in order, with their outcomes", () => {
    expect(trail(by(done))).toBe("build:pass check:pass ship:pass");
    expect(trail(by(stopped))).toBe("build:pass check:fail");
    expect(trail(by(waiting))).toBe("build:pass check:pass");
  });

  it("says where each run is and how it stands", () => {
    expect(by(done)).toMatchObject({ status: "done", stopCode: "done", at: null });
    expect(by(done).endedAt).not.toBeNull();
    expect(by(stopped)).toMatchObject({ status: "stopped", stopCode: "lane_failed", at: "check" });
    expect(by(waiting)).toMatchObject({
      status: "waiting",
      stopCode: "awaiting_approval",
      at: "ship",
      endedAt: null,
    });
  });

  it("has one sentence for each, with the lane by its name", () => {
    expect(by(done).sentence).toBe("Done.");
    expect(by(stopped).sentence).toMatch(/^Stopped: .*check/);
    expect(by(waiting).sentence).toBe("Ship it waits for your approval before it runs.");
    for (const r of runs) {
      expect(r.sentence.length).toBeLessThanOrEqual(160);
      expect(r.sentence).not.toContain("\n");
    }
  });

  it("adds up each run's tokens and cost from its lanes", () => {
    for (const r of runs) expect(r).toMatchObject({ tokens: 1200, usd: 0.25, usdUnknown: false });
  });

  it("says so when a cost is not known, and does not count it as nothing", async () => {
    sql(repo, (db) =>
      db.exec(`update sessions set usd = null, usd_source = 'unknown' where run_id = '${done}'`),
    );
    const again = (await jsonOf<{ runs: Row[] }>(await ui.api("/api/runs"))).runs;
    expect(again.filter((r) => r.usdUnknown).length).toBe(1);
  });

  it("sends every run that is moving or waiting, and the latest ended ones up to 50 in all", async () => {
    sql(repo, (db) => {
      const add = db.prepare(
        "insert into runs (id, task_id, workflow, status, stop_code, base_commit, branch, worktree, started_at, state) values (?, 1, 'starter', ?, ?, 'abc', 'b', 'w', ?, '{}')",
      );
      for (let i = 0; i < 60; i++) {
        const stamp = `2001-01-01T00:00:${String(i).padStart(2, "0")}.000Z`;
        // the oldest of them all still waits for a person
        add.run(
          `old${String(i).padStart(5, "0")}`,
          i === 0 ? "waiting" : "done",
          i === 0 ? "needs_person" : "done",
          stamp,
        );
      }
    });
    const many = (await jsonOf<{ runs: Row[] }>(await ui.api("/api/runs"))).runs;
    expect(many.length).toBe(50);
    expect(many.slice(0, 3).map((r) => r.id)).toEqual([waiting, stopped, done]);
    expect(many.map((r) => r.id)).toContain("old00000");
    expect(many.map((r) => r.id)).not.toContain("old00001");
    expect(many.map((r) => r.id)).toContain("old00059");
  });

  it("holds when a run's state or workflow cannot be read", async () => {
    sql(repo, (db) =>
      db.exec("update runs set state = 'not json', workflow = 'gone' where id like 'old0005%'"),
    );
    const answer = await ui.api("/api/runs");
    expect(answer.status).toBe(200);
    const all = (await jsonOf<{ runs: Row[] }>(answer)).runs;
    expect(all.length).toBe(50);
    expect(all.find((r) => r.id === "old00055")).toMatchObject({ sentence: "Done.", visits: [] });
  });

  it("says so when a run is marked as moving but its process is gone", async () => {
    // a pid no process has: the largest a 32-bit pid can be
    sql(repo, (db) =>
      db.exec("update runs set status = 'running', stop_code = null, pid = 2147483646 where id = 'old00058'"),
    );
    const all = (await jsonOf<{ runs: Row[] }>(await ui.api("/api/runs"))).runs;
    expect(all.find((r) => r.id === "old00058")?.sentence).toMatch(/its process is gone/i);
  });
});
