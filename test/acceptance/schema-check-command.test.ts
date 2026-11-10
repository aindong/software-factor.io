import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const run = (...args: string[]) =>
  spawnSync(process.execPath, ["scripts/check-workflows.ts", ...args], { encoding: "utf8" });

describe("pnpm run schema:check", () => {
  it("prints one line per workflow and exits 0", () => {
    const r = run();
    expect(r.status).toBe(0);
    for (const name of ["alleo-loop", "bugfix-fast", "research-only"]) {
      expect(r.stdout).toMatch(new RegExp(`ok\\s+workflows/${name}\\.json`));
    }
    const count = readdirSync("workflows").filter((f) => f.endsWith(".json")).length;
    expect(r.stdout.trim().split("\n")).toHaveLength(count);
  });

  it("is what the package script runs", () => {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
    expect(scripts["schema:check"]).toBe("node scripts/check-workflows.ts");
  });

  it("exits 1 and names the problem when a workflow breaks a rule", () => {
    const dir = mkdtempSync(join(tmpdir(), "sf-check-"));
    const good = join(dir, "good.json");
    const bad = join(dir, "bad.json");
    copyFileSync("workflows/bugfix-fast.json", good);
    const w = JSON.parse(readFileSync(good, "utf8"));
    w.lanes[0].on.pass = "nowhere";
    writeFileSync(bad, JSON.stringify(w));
    const r = run(bad, good);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/ok\s+.*good\.json/);
    expect(r.stdout).toMatch(/FAIL\s+.*bad\.json/);
    expect(r.stdout).toMatch(/nowhere/);
  });
});
