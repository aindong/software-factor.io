// The docs say what the report holds and what its check compares.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("names each part of the report, where prices come from, and the check", () => {
  const doc = readFileSync("docs/costs.md", "utf8");
  for (const said of [
    "softwarefactor cost",
    "By task",
    "By lane",
    "By account",
    "By model",
    "Cache hit rate",
    "Landed",
    "Most expensive runs that did not land",
    "--check",
    "prices.json",
    "subscription",
    "SHA-256",
  ]) {
    expect(doc, said).toContain(said);
  }
  expect(readFileSync("src/core/help.ts", "utf8")).toMatch(/cost \[--check\]/);
});
