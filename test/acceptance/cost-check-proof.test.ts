// From the review of task 24: a row that holds tokens must be provable, and the numbers of the
// report must be exact where the first version was not.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { priceOf } from "../../src/core/prices.ts";
import { ledger, printingAccount, section } from "../helpers/cost.ts";
import { agentLane, flowRepo, type Repo } from "../helpers/repo.ts";
import { sql } from "../helpers/runs.ts";

function claudeRun(): Repo {
  const repo = flowRepo({ lanes: [agentLane("build")] });
  const usage = {
    input_tokens: 11,
    output_tokens: 7,
    cache_read_input_tokens: 5,
    cache_creation_input_tokens: 3,
  };
  printingAccount(repo, "claude", [
    { type: "result", is_error: false, result: "ok", session_id: "s", total_cost_usd: 0.1, usage },
  ]);
  repo.sf("run");
  return repo;
}

it("fails on a changed Claude row whose transcript is no longer named", () => {
  const repo = claudeRun();
  sql(repo, (db) =>
    db.exec(
      "update sessions set input_tokens = input_tokens + 1, tokens = tokens + 1, transcript_path = null, transcript_sha256 = null",
    ),
  );
  const r = repo.sf("cost", "--check");
  expect(r.status, r.stdout).toBe(1);
  expect(r.stdout).toMatch(/names no transcript.*cannot be proved/);
});

it("fails on a row with tokens whose agent prints none that could be read again", () => {
  const repo = claudeRun();
  sql(repo, (db) =>
    db.exec("update sessions set agent = 'kimi', input_tokens = input_tokens + 1000, tokens = tokens + 1000"),
  );
  const r = repo.sf("cost", "--check");
  expect(r.status, r.stdout).toBe(1);
  expect(r.stdout).toMatch(/kimi.*cannot be proved/);
});

it("passes a session that used nothing and left nothing, whatever its agent", () => {
  const book = ledger();
  book.session(book.run(book.task("Alpha", "done"), "run-a", "done"), {
    agent: "kimi",
    model: null,
    usd: null,
  });
  const r = book.repo.sf("cost", "--check");
  expect(r.status, r.stdout).toBe(0);
});

it("says a cache hit rate that is a whole percent as that percent", () => {
  const book = ledger();
  const run = book.run(book.task("Alpha", "done"), "run-a", "done");
  book.session(run, { model: "m-29", input: 71, cacheRead: 29 }); // 0.29 * 100 is 28.999999999999996
  book.session(run, { model: "m-57", input: 43, cacheRead: 57 });
  const models = section(book.repo.sf("cost").stdout, "By model");
  expect(models.find((l) => l.includes("m-29"))).toMatch(/cache 29%/);
  expect(models.find((l) => l.includes("m-57"))).toMatch(/cache 57%/);
});

it("ranks a run that did not land by the cost that is known, and says what is not in it", () => {
  const book = ledger();
  const big = book.run(book.task("Big", "stopped"), "run-big", "stopped", "out_of_time");
  book.session(big, { usd: 50, input: 10 });
  book.session(big, { lane: "check", usd: null, input: 10 }); // a start that was cut off prints no cost
  book.session(book.run(book.task("Small", "stopped"), "run-small", "stopped", "gate_stop"), {
    usd: 0.01,
    input: 10,
  });
  // a run that used nothing and whose cost is not known is not an expensive one
  book.session(book.run(book.task("Empty", "stopped"), "run-empty", "stopped", "gate_stop"), { usd: null });
  const lines = section(book.repo.sf("cost").stdout, "Most expensive runs that did not land");
  expect(lines.map((l) => l.trim().split(/\s+/)[0])).toEqual(["run-big", "run-small"]);
  expect(lines[0]).toMatch(/\$50\.00\s+\(1 of unknown cost not counted\)/);
});

it("looks a model up as it is named, then without its context size, and drops a date only from a Claude name", () => {
  const repo = flowRepo({ lanes: [agentLane("build")] });
  process.env.FACTOR_HOME = repo.home;
  const used = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 };
  expect(priceOf("claude-sonnet-5-5-20260930[1m]", used)).toBe(priceOf("claude-sonnet-5-5", used));
  expect(priceOf("gpt-6-sol", used)).toBeGreaterThan(0);
  expect(priceOf("gpt-6-sol-20250101", used)).toBeUndefined();
  // a person's own price for a dated name is the one used, also with a context size behind it
  writeFileSync(
    join(repo.home, "prices.json"),
    JSON.stringify({ "claude-sonnet-5-5-20260930": { input: 77, output: 1 } }),
  );
  expect(priceOf("claude-sonnet-5-5-20260930[1m]", used)).toBe(77);
});
