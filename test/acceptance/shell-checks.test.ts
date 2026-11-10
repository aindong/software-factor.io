import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The document checks from phase 0 are shell scripts. Running them here puts them inside `pnpm test`,
// which is what the verify gate runs.
const scripts = readdirSync("test/acceptance").filter((f) => f.endsWith(".sh"));

describe("document checks", () => {
  it.each(scripts)("%s passes", (script) => {
    const r = spawnSync("bash", [`test/acceptance/${script}`], { encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
