import { describe, expect, it } from "vitest";
import { makeRepo } from "../helpers/repo.ts";

describe("softwarefactor check", () => {
  const repo = makeRepo();
  repo.sf("init");

  it("checks the workspace's workflows when given no file", () => {
    const r = repo.sf("check");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/ok\s+\.factor\/workflows\/starter\.json/);
  });

  it("names the place and the fix for each problem, and exits 1", () => {
    const w = repo.json<{ lanes: { on: { pass: string } }[] }>(".factor/workflows/starter.json");
    const lane = w.lanes[0];
    if (lane) lane.on.pass = "nowhere";
    repo.write("broken.json", JSON.stringify(w));
    const r = repo.sf("check", "broken.json", ".factor/workflows/starter.json");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/FAIL\s+broken\.json/);
    expect(r.stdout).toMatch(/lanes\[0\]\.on\.pass/);
    expect(r.stdout).toMatch(/fix: /);
    expect(r.stdout).toMatch(/ok\s+\.factor\/workflows\/starter\.json/);
  });
});
