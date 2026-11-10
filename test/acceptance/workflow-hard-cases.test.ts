import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseWorkflow } from "../../src/core/schema/parse.ts";

const dir = "test/fixtures/workflows/hard-cases";
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const lanesOf = (path: string) => JSON.stringify(JSON.parse(readFileSync(path, "utf8")).lanes);

// Every data row of the table under "## Processes a skeptic tried":
// | process | supported or known limit | fixture or reason |
const doc = existsSync("docs/workflow-schema.md") ? readFileSync("docs/workflow-schema.md", "utf8") : "";
const section = doc.split(/^## Processes a skeptic tried.*$/m)[1]?.split(/^## /m)[0] ?? "";
const rows = section
  .split("\n")
  .filter((l) => l.startsWith("|") && !/^\|\s*-+/.test(l))
  .slice(1)
  .map((l) => l.split("|").map((c) => c.trim()));
const supported = rows.filter((r) => /^supported$/i.test(r[2] ?? ""));
const fixtureOf = (r: string[]) => /`([a-z0-9-]+\.json)`/.exec(r[3] ?? "")?.[1];

describe("processes a skeptic said the schema could not hold", () => {
  it("are all marked supported or a known limit, at least four supported", () => {
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) expect(r[2], `row "${r[1]}"`).toMatch(/^(supported|known limit)$/i);
    expect(supported.length).toBeGreaterThanOrEqual(4);
  });

  it("each supported process has its own fixture, unlike the examples and each other", () => {
    const fixtures = supported.map(fixtureOf);
    for (const [i, f] of fixtures.entries()) {
      expect(f, `row "${supported[i]?.[1]}" names no fixture`).toBeDefined();
      expect(files).toContain(f);
    }
    expect(new Set(fixtures).size).toBe(supported.length);
    const shapes = [
      ...fixtures.map((f) => lanesOf(`${dir}/${f}`)),
      ...["alleo-loop", "bugfix-fast", "research-only"].map((n) => lanesOf(`workflows/${n}.json`)),
    ];
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it("each known limit gives its reason", () => {
    for (const r of rows.filter((r) => /^known limit$/i.test(r[2] ?? ""))) {
      expect((r[3] ?? "").length, `row "${r[1]}" gives no reason`).toBeGreaterThan(20);
    }
  });

  it.each(files.length ? files : ["(none yet)"])("%s parses with no problems", (file) => {
    expect(files.length).toBeGreaterThan(0);
    const result = parseWorkflow(JSON.parse(readFileSync(`${dir}/${file}`, "utf8")));
    expect(result.problems).toEqual([]);
  });
});
