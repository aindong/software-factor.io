// docs/retros.md names what opens a retro, the commands, where a lesson lives, and what is not built.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("names what opens a retro, the four commands, where a lesson is kept and how a gate is added", () => {
  const doc = readFileSync("docs/retros.md", "utf8");
  for (const said of [
    "softwarefactor escape",
    "softwarefactor retro",
    "softwarefactor retro draft",
    "softwarefactor retro keep",
    "softwarefactor retro drop",
    "--lesson",
    ".factor/retros/",
    ".factor/memory/lessons/",
    "3 of the last 20",
    "core/command@1",
  ])
    expect(doc, said).toContain(said);
  expect(doc).toMatch(/## Not built/);
  expect(doc).not.toMatch(/—|TODO|TBD/);
});
