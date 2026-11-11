// The docs and the help say what `cost --json` prints and that it does not go with `--check`.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("docs/costs.md and the help name --json, the operation it prints and the refusal with --check", () => {
  const doc = readFileSync("docs/costs.md", "utf8");
  expect(doc).toContain("softwarefactor cost --json");
  expect(doc).toMatch(/`costs` operation/);
  expect(doc).toMatch(/--json[^.]*--check[^.]*refus|refus[^.]*--json[^.]*--check/i);
  expect(readFileSync("src/core/help.ts", "utf8")).toMatch(/cost \[--check\] \[--json\]/);
});
