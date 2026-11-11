// The docs and the help say what `eval --list` prints and that it does not go with the flags that run the cases.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("docs/evals.md and the help name --list and the refusal with --break, --save and --compare", () => {
  const doc = readFileSync("docs/evals.md", "utf8");
  expect(doc).toContain("softwarefactor eval --list");
  expect(doc).toMatch(/--list[^.]*refus|refus[^.]*--list/i);
  const refusal = doc
    .split("\n")
    .filter((l) => /--list/.test(l) && /refus/i.test(l))
    .join(" ");
  for (const flag of ["--break", "--save", "--compare"]) expect(refusal, flag).toContain(flag);
  expect(readFileSync("src/core/help.ts", "utf8")).toMatch(/eval \[--list\] \[--break <gate>\]/);
});
