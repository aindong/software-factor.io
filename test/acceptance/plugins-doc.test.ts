// docs/plugins.md shows a manifest the factory accepts, names the commands, and says what is not built.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Manifest } from "../../src/core/plugins/manifest.ts";

it("shows a manifest that is valid, names each command, and says what is not built", () => {
  const doc = readFileSync("docs/plugins.md", "utf8");
  const blocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map(
    (m) => JSON.parse(m[1] ?? "") as { name?: string; collectors?: unknown },
  );
  const manifest = blocks.find((b) => b.name !== undefined && b.collectors !== undefined);
  expect(manifest, "a manifest in a json block").toBeDefined();
  expect(Manifest.safeParse(manifest).success).toBe(true);
  for (const command of [
    "softwarefactor add",
    "softwarefactor plugins --available",
    "softwarefactor allow --skill",
    "plugins.lock.json",
    "FACTOR_PLUGIN_DIR",
    "FACTOR_WITH",
  ])
    expect(doc, command).toContain(command);
  const notBuilt = doc.slice(doc.indexOf("## Not built"));
  for (const item of ["npm", "adapter", "theme", "registry"]) expect(notBuilt, item).toContain(item);
  expect(doc).not.toMatch(/—|TODO|TBD/);
});
