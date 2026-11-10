// From the reviews of task 15: what the record or an agent can make the run view do.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jsonOf, startUi, type Ui } from "../helpers/repo.ts";
import { sql, threeRuns } from "../helpers/runs.ts";

interface Row {
  id: string;
  sentence: string;
}
const { repo, done, stopped, waiting } = threeRuns();
let ui: Ui;
beforeAll(async () => {
  ui = await startUi(repo);
}, 120_000);
afterAll(() => ui?.stop());
const diffOf = async (id: string) =>
  jsonOf<{ diff: string; cut: boolean; note?: string; changed?: string[] }>(
    await ui.api(`/api/runs/${id}/diff`),
  );

describe("the run view, after review", () => {
  it("lists every changed file with the diff", async () => {
    const { changed, diff } = await diffOf(done);
    expect(changed).toEqual(["A\tsrc/feature.txt"]);
    expect(diff).toContain("+++ b/src/feature.txt");
  });

  it("cuts a diff too long to hold, and still names every file, instead of saying the commits are gone", async () => {
    const base = repo.git("rev-parse", "HEAD");
    repo.git("checkout", "-q", "-b", "huge");
    repo.write("aaa-fixture.txt", `${"x".repeat(99)}\n`.repeat(120_000)); // about 12 MB of diff, sorted first
    repo.write("zzz-the-real-change.txt", "the change that matters\n");
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "huge");
    const head = repo.git("rev-parse", "HEAD");
    repo.git("checkout", "-q", "main");
    sql(repo, (db) =>
      db.prepare("update runs set base_commit = ?, head_commit = ? where id = ?").run(base, head, stopped),
    );
    const body = await diffOf(stopped);
    expect(body.note ?? "").not.toContain("no longer in this repository");
    expect(body.cut).toBe(true);
    expect(body.diff.length).toBeLessThanOrEqual(1_000_000);
    expect(body.changed).toEqual(["A\taaa-fixture.txt", "A\tzzz-the-real-change.txt"]);
  }, 60_000);

  it("compares full commit ids only: a short one could be the name of a branch", async () => {
    const head = repo.git("rev-parse", "HEAD");
    repo.git("branch", "abcdef1", head);
    sql(repo, (db) => db.exec(`update runs set head_commit = 'abcdef1' where id = '${waiting}'`));
    const body = await diffOf(waiting);
    expect(body.diff).toBe("");
    expect(body.note).toBeTruthy();
  });

  it("reads an agent's output only from the run's own folder, whatever the record says", async () => {
    // a run of this test's own process, at work in a lane, whose record points somewhere else
    const elsewhere = join(repo.home, "elsewhere", "01-build");
    mkdirSync(`${elsewhere}.host`, { recursive: true });
    const said = {
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash", input: { command: "cat /etc/passwd" } }] },
    };
    writeFileSync(join(`${elsewhere}.host`, "stream.jsonl"), `${JSON.stringify(said)}\n`);
    sql(repo, (db) => {
      db.prepare(
        "insert into runs (id, task_id, workflow, status, base_commit, branch, worktree, pid, started_at, state) values ('forged01', 1, 'starter', 'running', 'abc', 'b', 'w', ?, '2030-01-01T00:00:00.000Z', '{}')",
      ).run(process.pid);
      db.exec(
        "insert into lane_runs (run_id, lane, seq, started_at) values ('forged01', 'build', 1, '2030-01-01T00:00:00.000Z')",
      );
      db.prepare(
        "insert into events (run_id, at, kind, data) values ('forged01', '2030-01-01T00:00:00.000Z', 'lane.agent', ?)",
      ).run(JSON.stringify({ lane: "build", handoffPath: join(elsewhere, "handoff.json") }));
    });
    const { runs } = await jsonOf<{ runs: Row[] }>(await ui.api("/api/runs"));
    expect(runs.find((r) => r.id === "forged01")?.sentence).toBe("Build: the agent is working.");
  });

  it("says a file is too large instead of sending its tail", async () => {
    const big = join(repo.dir, ".factor/runs", done, "evidence", "big.log");
    writeFileSync(big, Buffer.alloc(50_000_001, "a"));
    const answer = await ui.api(
      `/api/runs/${done}/file?path=${encodeURIComponent(`.factor/runs/${done}/evidence/big.log`)}`,
    );
    expect(answer.status).toBe(413);
    expect((await jsonOf<{ error: string }>(answer)).error).toMatch(/too large/);
  });
});
