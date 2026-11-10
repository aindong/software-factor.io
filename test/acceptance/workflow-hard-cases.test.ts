import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseWorkflow } from "../../src/core/schema/parse.ts";

const dir = "test/fixtures/workflows/hard-cases";
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const doc = existsSync("docs/workflow-schema.md") ? readFileSync("docs/workflow-schema.md", "utf8") : "";
// rows of the "Processes a skeptic tried" table: | process | supported or known limit | fixture or reason |
const rows = doc
  .split("\n")
  .filter((l) => /^\|.*\|\s*(supported|known limit)\s*\|/i.test(l))
  .map((l) => l.split("|").map((c) => c.trim()));

describe("processes a skeptic said the schema could not hold", () => {
  it("are listed in the docs, at least four of them supported", () => {
    const supported = rows.filter((r) => /supported/i.test(r[2] ?? ""));
    expect(supported.length).toBeGreaterThanOrEqual(4);
  });

  it("each supported process names a fixture that exists", () => {
    for (const r of rows.filter((r) => /supported/i.test(r[2] ?? ""))) {
      const fixture = /`([a-z0-9-]+\.json)`/.exec(r[3] ?? "")?.[1];
      expect(fixture, `row "${r[1]}" names no fixture`).toBeDefined();
      expect(files).toContain(fixture);
    }
  });

  it("each known limit gives its reason", () => {
    for (const r of rows.filter((r) => /known limit/i.test(r[2] ?? ""))) {
      expect((r[3] ?? "").length, `row "${r[1]}" gives no reason`).toBeGreaterThan(20);
    }
  });

  it.each(files.length ? files : ["(none yet)"])("%s parses with no problems", (file) => {
    expect(files.length).toBeGreaterThan(0);
    const result = parseWorkflow(JSON.parse(readFileSync(`${dir}/${file}`, "utf8")));
    expect(result.problems).toEqual([]);
  });
});
