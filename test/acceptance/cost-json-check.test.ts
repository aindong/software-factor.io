// `--json` and `--check` do not go together: one prints the report, the other proves it.
import { expect, it } from "vitest";
import { ledger } from "../helpers/cost.ts";

it("refuses --json with --check in words, exit 1, and prints no report", () => {
  const book = ledger();
  book.session(book.run(book.task("Alpha", "done"), "run-a", "done"), { input: 5 });
  for (const args of [
    ["cost", "--json", "--check"],
    ["cost", "--check", "--json"],
  ]) {
    const refused = book.repo.sf(...args);
    expect(refused.status, args.join(" ")).toBe(1);
    expect(refused.stdout, args.join(" ")).toBe("");
    expect(refused.stderr).toMatch(/--json/);
    expect(refused.stderr).toMatch(/--check/);
    expect(refused.stderr).toMatch(/fix:/);
  }
});
