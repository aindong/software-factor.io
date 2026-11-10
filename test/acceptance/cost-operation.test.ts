// The `costs` operation gives what the command prints: the kinds by lane, by model, landed tasks and failed runs.
import { expect, it } from "vitest";
import { ledger } from "../helpers/cost.ts";
import { tool } from "../helpers/operator.ts";

it("returns the kinds by lane as the session rows add up, beside the lines it always had", () => {
  const book = ledger();
  const a = book.run(book.task("Alpha", "done"), "run-a", "done");
  book.session(a, { input: 11, output: 7, cacheRead: 5, cacheWrite: 3, usd: 0.01 });
  book.session(a, {
    lane: "check",
    model: "gpt-6.1-sol",
    agent: "codex",
    input: 13,
    output: 17,
    cacheRead: 19,
    cacheWrite: 23,
  });
  book.session(book.run(book.task("Beta", "stopped"), "run-b", "stopped", "gate_stop"), {
    input: 101,
    usd: 0.3,
  });

  const report = tool<Record<string, unknown>>(book.repo, "costs").data;
  expect(report.usage).toEqual(
    book.repo.rows(
      "select lane, sum(input_tokens) as input, sum(output_tokens) as output, sum(cache_read_tokens) as cacheRead, sum(cache_write_tokens) as cacheWrite, sum(tokens) as tokens from sessions group by lane order by min(id)",
    ),
  );
  expect(report.byLane).toEqual([
    { lane: "build", sessions: 2, tokens: 127, usd: 0.31, unknown: 0 },
    { lane: "check", sessions: 1, tokens: 72, usd: 0.01, unknown: 0 },
  ]);
  expect(report.byModel).toMatchObject([
    { model: "claude-sonnet-5-5", sessions: 2, tokens: 127 },
    { model: "gpt-6.1-sol", sessions: 1, tokens: 72 },
  ]);
  expect(report.landed).toMatchObject({ tasks: 1, ended: 2 });
  expect(report.failedRuns).toMatchObject([
    { run: "run-b", task: "Beta", why: "gate_stop", tokens: 101, usd: 0.3 },
  ]);
});
