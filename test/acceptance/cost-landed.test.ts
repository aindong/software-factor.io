// What a landed task cost: every run of the tasks that ended done, the failed ones included, over their number.
import { expect, it } from "vitest";
import { ledger, section } from "../helpers/cost.ts";
import { tool } from "../helpers/operator.ts";

interface Landed {
  tasks: number;
  ended: number;
  perTask: number | null;
  spent: { usd: number | null; unknown: number };
  notLanded: { usd: number | null };
  other: { usd: number | null };
}

it("divides what the landed tasks cost, their stopped runs included, by their number", () => {
  const book = ledger();
  const alpha = book.task("Alpha", "done");
  book.session(book.run(alpha, "run-a1", "stopped", "gate_stop"), { usd: 0.1 });
  book.session(book.run(alpha, "run-a2", "done"), { usd: 0.2 });
  const beta = book.run(book.task("Beta", "done"), "run-b1", "done");
  book.session(beta, { usd: 0.3 });
  book.session(beta, { lane: "check", usd: null });
  book.session(book.run(book.task("Gamma", "stopped"), "run-c1", "stopped", "lane_failed"), { usd: 0.07 });
  book.session(book.run(book.task("Delta", "waiting"), "run-d1", "waiting"), { usd: 0.05 });
  book.session("run-gone", { usd: 0.02 });

  const out = book.repo.sf("cost").stdout;
  const landed = section(out, "Landed").join("\n");
  expect(landed).toMatch(/2 of 3 ended tasks landed/);
  // 0.1 + 0.2 + 0.3 is not 0.6 in floating point: the amount is still exact
  expect(landed).toMatch(/cost per landed task\s+\$0\.30\b/i);
  expect(landed).toMatch(/1 session of unknown cost/);
  expect(landed).toMatch(/did not land\s+\$0\.07\b/);
  expect(landed).toMatch(/still open, or no longer in the record\s+\$0\.07\b/);

  const report = tool<{ landed: Landed; total: { usd: number } }>(book.repo, "costs").data;
  expect(report.landed).toMatchObject({ tasks: 2, ended: 3, perTask: 0.3 });
  expect(report.landed.spent).toMatchObject({ usd: 0.6, unknown: 1 });
  const parts = [report.landed.spent, report.landed.notLanded, report.landed.other];
  expect(Math.round(parts.reduce((sum, p) => sum + (p.usd ?? 0), 0) * 1e6) / 1e6).toBe(report.total.usd);
});

it("divides nothing when no task has landed, and does not call an unknown cost nothing", () => {
  const none = ledger();
  none.session(none.run(none.task("Gamma", "stopped"), "run-c1", "stopped"), { usd: 0.07 });
  const out = none.repo.sf("cost").stdout;
  expect(section(out, "Landed").join("\n")).toMatch(/No task has landed/);
  expect(out).not.toMatch(/per landed task/i);
  expect(tool<{ landed: Landed }>(none.repo, "costs").data.landed).toMatchObject({ tasks: 0, perTask: null });

  const unknown = ledger();
  unknown.session(unknown.run(unknown.task("Alpha", "done"), "run-a", "done"), { usd: null });
  const landed = section(unknown.repo.sf("cost").stdout, "Landed").join("\n");
  expect(landed).toMatch(/cost per landed task\s+unknown/i);
  expect(landed).not.toMatch(/\$0/);
});
