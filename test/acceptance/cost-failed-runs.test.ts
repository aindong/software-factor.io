// The most expensive runs that did not land: by known cost, then the ones of unknown cost by tokens. Five at most.
import { expect, it } from "vitest";
import { ledger, section } from "../helpers/cost.ts";
import { tool } from "../helpers/operator.ts";

it("lists exactly five, in order, and no run that landed or is still open", () => {
  const book = ledger();
  const failed = (id: string, status: string, used: { usd: number | null; input?: number }, code?: string) =>
    book.session(book.run(book.task(`Task of ${id}`, "stopped"), id, status, code), used);
  failed("run-f1", "stopped", { usd: 0.4 }, "gate_stop");
  failed("run-f2", "dropped", { usd: 0.9 });
  failed("run-f3", "stopped", { usd: 0.1 }, "out_of_rounds");
  failed("run-f4", "stopped", { usd: 0.2 }, "lane_failed");
  failed("run-u1", "stopped", { usd: null, input: 5000 }, "gate_stop");
  failed("run-u2", "stopped", { usd: null, input: 9000 }, "gate_stop");
  book.session(book.run(book.task("Waiting", "waiting"), "run-w1", "waiting"), { usd: 5 });
  book.session(book.run(book.task("Done", "done"), "run-d1", "done"), { usd: 7 });

  const lines = section(book.repo.sf("cost").stdout, "Most expensive runs that did not land");
  expect(lines.map((l) => l.trim().split(/\s+/)[0])).toEqual([
    "run-f2",
    "run-f1",
    "run-f4",
    "run-f3",
    "run-u2",
  ]);
  expect(lines[0]).toMatch(/Task of run-f2.*dropped.*\$0\.90/);
  expect(lines[1]).toMatch(/gate_stop.*\$0\.40/);
  expect(lines[4]).toMatch(/9000 tokens\s+unknown/);

  const report = tool<{ failedRuns: { run: string; usd: number | null; why: string }[] }>(
    book.repo,
    "costs",
  ).data;
  expect(report.failedRuns.map((r) => r.run)).toEqual(["run-f2", "run-f1", "run-f4", "run-f3", "run-u2"]);
  expect(report.failedRuns[4]).toMatchObject({ usd: null, why: "gate_stop" });
});

it("leaves the section out when every run landed", () => {
  const book = ledger();
  book.session(book.run(book.task("Done", "done"), "run-d1", "done"), { usd: 7 });
  expect(book.repo.sf("cost").stdout).not.toMatch(/Most expensive runs/);
});
