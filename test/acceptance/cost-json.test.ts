// `softwarefactor cost --json` prints what the `costs` operation returns, as one JSON document.
import { expect, it } from "vitest";
import { ledger } from "../helpers/cost.ts";
import { tool } from "../helpers/operator.ts";

it("prints the report the costs operation returns, as one document on stdout and nothing else", () => {
  const book = ledger();
  const a = book.run(book.task("Alpha", "done"), "run-a", "done");
  book.session(a, { input: 11, output: 7, cacheRead: 5, cacheWrite: 3, usd: 0.01 });
  book.session(a, { lane: "check", model: "gpt-6.1-sol", agent: "codex", input: 13, output: 17, usd: null });
  book.session(book.run(book.task("Beta", "stopped"), "run-b", "stopped", "gate_stop"), { input: 101 });

  const printed = book.repo.sf("cost", "--json");
  expect(printed.status, printed.stderr).toBe(0);
  expect(printed.stderr).toBe("");
  // one document: the whole of stdout parses, and the text ends in one newline
  expect(printed.stdout.endsWith("\n")).toBe(true);
  const report = JSON.parse(printed.stdout);
  expect(report).toEqual(tool(book.repo, "costs").data);
  expect(report.total.sessions).toBe(3);
  expect(report.byLane).toHaveLength(2);
});
