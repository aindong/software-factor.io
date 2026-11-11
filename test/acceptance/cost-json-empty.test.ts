// With no sessions `cost --json` prints the same shape as with some, with empty lists.
import { expect, it } from "vitest";
import { ledger } from "../helpers/cost.ts";
import { tool } from "../helpers/operator.ts";

it("prints the shape of the report with empty lists, not the sentence the text form prints", () => {
  const book = ledger();
  const printed = book.repo.sf("cost", "--json");
  expect(printed.status, printed.stderr).toBe(0);
  expect(printed.stderr).toBe("");
  const report = JSON.parse(printed.stdout);
  expect(report).toEqual(tool(book.repo, "costs").data);
  for (const list of ["usage", "byTask", "byLane", "byAccount", "byModel", "failedRuns"])
    expect(report[list], list).toEqual([]);
  expect(report.total.sessions).toBe(0);

  // the keys are those of a report with a session in it
  const a = book.run(book.task("Alpha", "done"), "run-a", "done");
  book.session(a, { input: 1 });
  const full = JSON.parse(book.repo.sf("cost", "--json").stdout);
  expect(Object.keys(report).sort()).toEqual(Object.keys(full).sort());
});
