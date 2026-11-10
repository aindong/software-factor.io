// docs/evals.md names every case the command runs, its options, and what the suite does not cover.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { CASE_IDS } from "../../src/core/eval/cases.ts";

it("names every case, the options, and what is not covered", () => {
  const doc = readFileSync("docs/evals.md", "utf8");
  expect(CASE_IDS.length).toBeGreaterThanOrEqual(9);
  for (const id of CASE_IDS) expect(doc, id).toContain(`\`${id}\``);
  for (const said of ["softwarefactor eval", "--break", "--save", "--compare", "core/no-secrets@1"])
    expect(doc, said).toContain(said);
  expect(doc).toMatch(/## What it does not cover/);
  expect(doc).not.toMatch(/—|TODO|TBD/);
});
