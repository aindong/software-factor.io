// docs/ladder.md names the steps, the rule, the commands, and what is not built.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("names the three steps, the rule for a suggestion, both commands, and what is not built", () => {
  const doc = readFileSync("docs/ladder.md", "utf8");
  for (const said of [
    "in the loop",
    "near the loop",
    "out of the loop",
    "10 runs",
    '"ladder"',
    "softwarefactor ladder",
    "softwarefactor ladder accept",
    "softwarefactor escape",
    "--lane",
    "--note",
    "pin",
    "oneWay",
  ])
    expect(doc, said).toContain(said);
  expect(doc).toMatch(/## Not built/);
  expect(doc).not.toMatch(/—|TODO|TBD/);
});
