// The cache hit rate: cache read over everything that went in, rounded down, pooled, and never 0% for "none".
import { expect, it } from "vitest";
import { ledger, section } from "../helpers/cost.ts";
import { tool } from "../helpers/operator.ts";

it("says the rate by model and for the whole, rounded down and pooled", () => {
  const book = ledger();
  const run = book.run(book.task("Alpha", "done"), "run-a", "done");
  book.session(run, { model: "m-one", input: 60, cacheRead: 200, cacheWrite: 40, output: 9 }); // 200 of 300
  book.session(run, { model: "m-two", input: 1, cacheRead: 999, output: 9 }); // 999 of 1000
  book.session(run, { model: "m-out", agent: "codex", output: 50 }); // nothing went in
  // the scripted agent names no kinds: all it used is counted as input, and it has no cache
  book.session(run, { model: null, account: null, agent: "fake", input: 5000 });

  const out = book.repo.sf("cost").stdout;
  const models = section(out, "By model");
  expect(models.find((l) => l.includes("m-one"))).toMatch(/cache 66%/);
  expect(models.find((l) => l.includes("m-two"))).toMatch(/cache 99%/);
  expect(models.find((l) => l.includes("m-out"))).not.toMatch(/cache/);
  expect(models.find((l) => l.includes("(no model named)"))).not.toMatch(/cache/);
  // 1199 of 1300: not the mean of 66 and 99, and not dragged down by the scripted agent's 5000
  expect(out).toMatch(/^Cache hit rate\s+92%/m);
  const report = tool<{
    cacheRate: number | null;
    byModel: { model: string | null; cacheRate: number | null }[];
  }>(book.repo, "costs").data;
  expect(report.cacheRate).toBe(92);
  expect(report.byModel.map((m) => [m.model, m.cacheRate])).toEqual([
    ["m-one", 66],
    ["m-two", 99],
    ["m-out", null],
    [null, null],
  ]);
});

it("says no rate at all when nothing could have come from a cache", () => {
  const book = ledger();
  book.session(book.run(book.task("Alpha", "done"), "run-a", "done"), {
    model: null,
    account: null,
    agent: "fake",
    input: 100,
  });
  const out = book.repo.sf("cost").stdout;
  expect(out).not.toMatch(/\d+%/);
  expect(out).toMatch(/^Cache hit rate\s+none/m);
});
