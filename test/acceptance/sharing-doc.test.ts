// docs/sharing.md shows an export the import accepts, names the commands, and says what is left out.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { readExport } from "../../src/core/sharing.ts";

it("shows a valid export, both commands with their options, and what an export does not carry", () => {
  const doc = readFileSync("docs/sharing.md", "utf8");
  const block = [...doc.matchAll(/```json\n([\s\S]*?)```/g)]
    .map((m) => m[1] ?? "")
    .find((b) => b.includes("softwarefactorExport"));
  expect(block, "an export in a json block").toBeDefined();
  expect(() => readExport(block ?? "", "the doc")).not.toThrow();
  for (const said of [
    "softwarefactor export",
    "--out",
    "softwarefactor import",
    "--yes",
    "--use",
    "--keep-checkpoints",
    "softwarefactor role bind",
    "softwarefactor add",
  ])
    expect(doc, said).toContain(said);
  const not = doc.slice(doc.indexOf("## What an export does not carry"));
  for (const item of ["account", "factory.json", "approval", "lesson"]) expect(not, item).toContain(item);
  expect(doc).not.toMatch(/—|TODO|TBD/);
});
