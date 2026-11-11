// From the correctness review of task 15: what the sentence says while a lane is open, for the
// shapes the engine leaves in the record: a repair round, a wait lane, a panel.
import type { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { agentLane, flowRepo, jsonOf, panelLane, type Repo, startUi, type Ui } from "../helpers/repo.ts";
import { sql } from "../helpers/runs.ts";

const at = (s: number) => `2099-01-01T00:00:0${s}.000Z`;
const uis: Ui[] = [];
afterAll(async () => {
  for (const ui of uis) await ui.stop();
});
/** A run of this test's own process, moving, as the engine would have left it. */
function moving(repo: Repo, id: string, next: string, more: (db: DatabaseSync) => void): void {
  const made = repo.sf("status"); // the record is made by the first command that reads it
  if (made.status !== 0) throw new Error(`the workspace does not load: ${made.stderr}`);
  sql(repo, (db) => {
    db.prepare(
      "insert or ignore into tasks (id, collector, key, title, created_at) values (1, 'tasks', 'k', 'A task', ?)",
    ).run(at(0));
    db.prepare(
      "insert into runs (id, task_id, workflow, status, base_commit, branch, worktree, started_at, state, pid) values (?, 1, 'starter', 'running', 'abc', 'b', 'w', ?, ?, ?)",
    ).run(id, at(0), JSON.stringify({ next }), process.pid);
    more(db);
  });
}
async function rowOf(repo: Repo, id: string) {
  const ui = await startUi(repo);
  uis.push(ui);
  const { runs } = await jsonOf<{ runs: { id: string; at: string | null; sentence: string }[] }>(
    await ui.api("/api/runs"),
  );
  return runs.find((r) => r.id === id);
}
const event = (db: DatabaseSync, run: string) =>
  db.prepare(`insert into events (run_id, at, kind, data) values ('${run}', ?, ?, ?)`);

describe("the sentence while a lane is open", () => {
  it("counts the gates of the check that is running, not those of the check before a repair", async () => {
    const repo = flowRepo({ lanes: [agentLane("build", { name: "Build", gates: ["verify"] })] });
    moving(repo, "repair", "build", (db) => {
      const lane = Number(
        db
          .prepare("insert into lane_runs (run_id, lane, seq, started_at) values ('repair', 'build', 1, ?)")
          .run(at(0)).lastInsertRowid,
      );
      const add = event(db, "repair");
      const data = JSON.stringify({ lane: "build" });
      add.run(at(1), "lane.agent", data);
      add.run(at(2), "lane.session", data);
      // the first check: the gate failed, and the agent is sent back to repair
      db.prepare(
        "insert into gate_results (run_id, lane_run_id, gate, uses, command, exit_code, status, tree_hash, output_path, output_sha256, duration_ms, attempt, started_at) values ('repair', ?, 'verify', 'core/command@1', 'false', 1, 'fail', 't', 'p', 's', 5, 1, ?)",
      ).run(lane, at(3));
      add.run(at(4), "lane.agent", data);
      add.run(at(5), "lane.session", data); // the second check has begun: none of its gates is done
    });
    expect((await rowOf(repo, "repair"))?.sentence).toBe(
      "Build: the agent has finished and its gates are running (0 of 1 done).",
    );
  }, 120_000);

  it("does not speak of an agent while a wait lane's check runs", async () => {
    const hold = {
      id: "hold",
      name: "Hold",
      uses: "core/wait@1",
      with: { minutes: 5 },
      checkpoint: "out",
      on: { pass: "@done", fail: "@stop" },
    };
    const repo = flowRepo({
      lanes: [agentLane("build", { name: "Build", on: { pass: "hold", fail: "@stop" } }), hold],
    });
    moving(repo, "held", "hold", (db) => {
      db.prepare(
        "insert into lane_runs (run_id, lane, seq, outcome, started_at, ended_at) values ('held', 'build', 1, 'pass', ?, ?)",
      ).run(at(0), at(3));
      const add = event(db, "held");
      add.run(at(1), "lane.agent", JSON.stringify({ lane: "build" }));
      add.run(at(2), "lane.session", JSON.stringify({ lane: "build" }));
      // the wait lane is open: its check command is running
      db.prepare("insert into lane_runs (run_id, lane, seq, started_at) values ('held', 'hold', 2, ?)").run(
        at(4),
      );
    });
    const run = await rowOf(repo, "held");
    expect(run?.at).toBe("hold");
    expect(run?.sentence).toBe("Hold: looking whether its condition holds.");
  }, 120_000);

  it("does not take the lane before for this one, before this lane's agent has started", async () => {
    const repo = flowRepo({
      lanes: [
        agentLane("build", { name: "Build", on: { pass: "review", fail: "@stop" } }),
        agentLane("review", { name: "Review", gates: ["verify"] }),
      ],
    });
    moving(repo, "fresh", "review", (db) => {
      db.prepare(
        "insert into lane_runs (run_id, lane, seq, outcome, started_at, ended_at) values ('fresh', 'build', 1, 'pass', ?, ?)",
      ).run(at(0), at(3));
      const add = event(db, "fresh");
      add.run(at(1), "lane.agent", JSON.stringify({ lane: "build" }));
      add.run(at(2), "lane.session", JSON.stringify({ lane: "build" }));
      db.prepare(
        "insert into lane_runs (run_id, lane, seq, started_at) values ('fresh', 'review', 2, ?)",
      ).run(at(4));
    });
    expect((await rowOf(repo, "fresh"))?.sentence).toBe("Review: the agent is working.");
  }, 120_000);

  it("counts the panel members at work, not those the workflow lists", async () => {
    const repo = flowRepo({
      lanes: [
        panelLane([{ id: "a" }, { id: "b" }, { id: "c", when: { ref: "task.labels", in: ["security"] } }], {
          name: "Review",
        }),
      ],
    });
    moving(repo, "panel", "review", (db) => {
      db.prepare(
        "insert into lane_runs (run_id, lane, seq, started_at) values ('panel', 'review', 1, ?)",
      ).run(at(0));
      // two members were started: the third has a condition that does not hold for this change
      const add = event(db, "panel");
      add.run(at(1), "lane.agent", JSON.stringify({ lane: "review.a" }));
      add.run(at(1), "lane.agent", JSON.stringify({ lane: "review.b" }));
    });
    const ui = await startUi(repo);
    uis.push(ui);
    const sentence = async () =>
      (await jsonOf<{ runs: { id: string; sentence: string }[] }>(await ui.api("/api/runs"))).runs.find(
        (r) => r.id === "panel",
      )?.sentence;
    expect(await sentence()).toBe("Review: 2 reviewers are at work.");
    sql(repo, (db) => event(db, "panel").run(at(2), "lane.session", JSON.stringify({ lane: "review.a" })));
    expect(await sentence()).toBe("Review: 1 reviewer is at work.");
    sql(repo, (db) => event(db, "panel").run(at(3), "lane.session", JSON.stringify({ lane: "review.b" })));
    expect(await sentence()).toBe("Review: its reviewers have finished and the host is checking their work.");
  }, 120_000);

  it("adds up tokens and cost from the sessions, also while their lane is still open", async () => {
    const repo = flowRepo({ lanes: [agentLane("build", { name: "Build" })] });
    moving(repo, "open", "build", (db) => {
      const lane = Number(
        db
          .prepare("insert into lane_runs (run_id, lane, seq, started_at) values ('open', 'build', 1, ?)")
          .run(at(0)).lastInsertRowid,
      );
      const add = db.prepare(
        "insert into sessions (run_id, lane_run_id, lane, try, agent, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tokens, usd, usd_source, started_at, duration_ms) values ('open', ?, 'build', ?, 'fake', 0, 0, 0, 0, ?, ?, 'reported', ?, 1)",
      );
      add.run(lane, 1, 700, 0.1, at(1));
      add.run(lane, 2, 300, 0.05, at(2));
    });
    const ui = await startUi(repo);
    uis.push(ui);
    const { runs } = await jsonOf<{ runs: { id: string; tokens: number; usd: number }[] }>(
      await ui.api("/api/runs"),
    );
    expect(runs.find((r) => r.id === "open")).toMatchObject({ tokens: 1000, usd: 0.15 });
  }, 120_000);

  it("says since when the lane has worked, and says it only of a run that works", async () => {
    const repo = flowRepo({ lanes: [agentLane("build", { name: "Build" })] });
    moving(repo, "since", "build", (db) =>
      db
        .prepare("insert into lane_runs (run_id, lane, seq, started_at) values ('since', 'build', 1, ?)")
        .run(at(4)),
    );
    const ui = await startUi(repo);
    uis.push(ui);
    type Row = { id: string; workingSince: string | null; lastAt: string | null };
    const row = async () =>
      (await jsonOf<{ runs: Row[] }>(await ui.api("/api/runs"))).runs.find((r) => r.id === "since");
    // no output of the agent has been seen: only the start of the lane is known, and it is not "activity"
    expect(await row()).toMatchObject({ workingSince: at(4), lastAt: null });
    sql(repo, (db) => db.exec("update runs set status = 'waiting', stop_code = 'awaiting_approval' where id = 'since'"));
    expect(await row()).toMatchObject({ workingSince: null, lastAt: null });
  }, 120_000);
});
