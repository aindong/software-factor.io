// docs/collectors.md names every built-in collector with an example a workflow could hold.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { BUILTINS } from "../../src/core/schema/builtins.ts";

it("describes each built-in collector with an example that fits its settings, and says what is not built", () => {
  const doc = readFileSync("docs/collectors.md", "utf8");
  const examples = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map(
    (m) => JSON.parse(m[1] ?? "") as { uses?: string; with?: unknown },
  );
  for (const [uses, settings] of Object.entries(BUILTINS.collector)) {
    expect(doc, uses).toContain(`\`${uses}\``);
    const example = examples.find((e) => e.uses === uses);
    expect(example, `an example for ${uses}`).toBeDefined();
    expect(settings?.safeParse(example?.with).success, `the example for ${uses} fits`).toBe(true);
  }
  expect(doc).toMatch(/## Not built/);
  expect(doc).not.toMatch(/—|TODO|TBD/);
});
