import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { op, tool } from "../helpers/operator.ts";
import { startUi, type Ui } from "../helpers/repo.ts";
import { sql, threeRuns } from "../helpers/runs.ts";

interface Line {
  sessions: number;
  tokens: number;
  /** The known cost. Null when no session of the line has one: never 0 for "not known". */
  usd: number | null;
  unknown: number;
}
interface Costs {
  byLane: (Line & { lane: string })[];
  byTask: (Line & { task: string; runs: string[] })[];
  byAccount: (Line & { account: string | null; agent: string })[];
  total: Line;
}
const { repo, done, stopped, waiting } = threeRuns();
// one more start of an agent on another lane and account, and one session whose cost is not known
sql(repo, (db) => {
  const lane = db.prepare("select id from lane_runs where run_id = ? and lane = 'check'").get(done) as {
    id: number;
  };
  db.prepare(
    "insert into sessions (run_id, lane_run_id, lane, try, account, agent, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tokens, usd, usd_source, started_at, duration_ms) values (?, ?, 'check', 1, 'work', 'claude', 'sonnet', 10, 5, 0, 0, 15, 0.0375, 'reported', '2026-11-10T10:00:00.000Z', 1)",
  ).run(done, lane.id);
  db.exec(`update sessions set usd = null, usd_source = 'unknown' where run_id = '${stopped}'`);
});
let ui: Ui;
beforeAll(async () => {
  ui = await startUi(repo);
}, 120_000);
afterAll(() => ui?.stop());

describe("costs", () => {
  it("come by lane, by task and by account, each the exact sum of its sessions", async () => {
    const { body } = await op<Costs>(ui, "costs");
    expect(body.byLane).toEqual([
      { lane: "build", sessions: 3, tokens: 3600, usd: 0.5, unknown: 1 },
      { lane: "check", sessions: 1, tokens: 15, usd: 0.0375, unknown: 0 },
    ]);
    expect(body.byTask).toEqual([
      { task: "First task", runs: [done], sessions: 2, tokens: 1215, usd: 0.2875, unknown: 0 },
      { task: "Second task", runs: [stopped], sessions: 1, tokens: 1200, usd: null, unknown: 1 },
      { task: "Third task", runs: [waiting], sessions: 1, tokens: 1200, usd: 0.25, unknown: 0 },
    ]);
    expect(body.byAccount).toEqual([
      { account: null, agent: "fake", sessions: 3, tokens: 3600, usd: 0.5, unknown: 1 },
      { account: "work", agent: "claude", sessions: 1, tokens: 15, usd: 0.0375, unknown: 0 },
    ]);
    expect(body.total).toEqual({ sessions: 4, tokens: 3615, usd: 0.5375, unknown: 1 });
  });

  it("match the session records to the token", async () => {
    const { body } = await op<Costs>(ui, "costs");
    const [sum] = repo.rows<{ tokens: number; usd: number; n: number }>(
      "select sum(tokens) as tokens, sum(usd) as usd, count(*) as n from sessions",
    );
    expect(body.total.tokens).toBe(sum?.tokens);
    expect(body.total.sessions).toBe(sum?.n);
    expect(body.total.usd).toBeCloseTo(sum?.usd ?? 0, 9);
    for (const key of ["byLane", "byTask", "byAccount"] as const) {
      expect(
        body[key].reduce((t, l) => t + l.tokens, 0),
        key,
      ).toBe(sum?.tokens);
      expect(
        body[key].reduce((t, l) => t + l.unknown, 0),
        key,
      ).toBe(1);
    }
  });

  it("are the same through the MCP server, and the command line prints the same numbers", async () => {
    expect(tool<Costs>(repo, "costs").data).toEqual((await op<Costs>(ui, "costs")).body);
    const printed = repo.sf("cost");
    expect(printed.status).toBe(0);
    for (const words of [
      "build",
      "check",
      "First task",
      "Second task",
      "3600",
      "1215",
      "$0.5375",
      "$0.2875",
      "(the scripted agent)",
      "work",
    ]) {
      expect(printed.stdout, words).toContain(words);
    }
    expect(printed.stdout).toMatch(/1 session of unknown cost is not in the totals/);
    // a task whose only session has no known cost says so, and does not say $0
    expect(printed.stdout).toMatch(/Second task.*unknown/);
  });

  it("add amounts that do not add exactly in floating point, and two tries of one lane", async () => {
    sql(repo, (db) => {
      const lane = db
        .prepare("select id from lane_runs where run_id = ? and lane = 'build'")
        .get(waiting) as {
        id: number;
      };
      const add = db.prepare(
        "insert into sessions (run_id, lane_run_id, lane, try, account, agent, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tokens, usd, usd_source, started_at, duration_ms) values (?, ?, 'tidy', ?, 'spare', 'codex', 0, 0, 0, 0, ?, ?, ?, '2026-11-10T11:00:00.000Z', 1)",
      );
      add.run(waiting, lane.id, 1, 10, 0.1, "priced");
      add.run(waiting, lane.id, 2, 20, 0.2, "priced");
      add.run(waiting, lane.id, 3, 30, null, "unknown");
    });
    const { body } = await op<Costs>(ui, "costs");
    expect(body.byLane.find((l) => l.lane === "tidy")).toEqual({
      lane: "tidy",
      sessions: 3,
      tokens: 60,
      usd: 0.3,
      unknown: 1,
    });
    expect(body.byAccount.find((l) => l.account === "spare")).toEqual({
      account: "spare",
      agent: "codex",
      sessions: 3,
      tokens: 60,
      usd: 0.3,
      unknown: 1,
    });
    expect(body.total).toEqual({ sessions: 7, tokens: 3675, usd: 0.8375, unknown: 2 });
    // every amount the command line prints is one the operation gave
    const printed = repo.sf("cost").stdout;
    const amounts = [...printed.matchAll(/\$(\d+\.\d{4})/g)].map((m) => Number(m[1]));
    const known = [...body.byLane, ...body.byTask, ...body.byAccount, body.total].map((l) => l.usd);
    expect(amounts.length).toBeGreaterThanOrEqual(8);
    for (const amount of amounts) expect(known, `$${amount}`).toContain(amount);
  });

  it("say so when nothing has been recorded", async () => {
    sql(repo, (db) => db.exec("delete from sessions"));
    expect((await op<Costs>(ui, "costs")).body).toEqual({
      byLane: [],
      byTask: [],
      byAccount: [],
      total: { sessions: 0, tokens: 0, usd: null, unknown: 0 },
    });
    expect(repo.sf("cost").stdout).toMatch(/No sessions yet/);
  });
});
