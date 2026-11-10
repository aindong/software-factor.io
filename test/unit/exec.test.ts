import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hostEnv, sh } from "../../src/core/exec.ts";
import { factorHome } from "../../src/core/workspace.ts";

const cwd = mkdtempSync(join(tmpdir(), "sf-exec-"));
const run = (command: string, timeoutMs = 10_000) => sh(command, { cwd, env: hostEnv(), timeoutMs });

describe("running a host command", () => {
  it("returns as soon as the command exits, even if it left something in the background", async () => {
    const started = Date.now();
    const r = await run("sleep 30 & echo done");
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain("done");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("reports a timeout as exit 124 and says so", async () => {
    const r = await run("sleep 30", 300);
    expect(r).toMatchObject({ exitCode: 124, timedOut: true });
    expect(r.output).toMatch(/timed out/);
  });

  it("treats a very long timeout as long, not as zero", async () => {
    const r = await run("sleep 0.3; echo ok", 40_000 * 60_000);
    expect(r.exitCode).toBe(0);
  });

  it("marks output it had to cut", async () => {
    const r = await run("head -c 3000000 /dev/zero | tr '\\0' 'a'");
    expect(r.output.length).toBeLessThan(2_200_000);
    expect(r.output).toMatch(/output cut/);
  });

  it("gives the command only the allowed environment", async () => {
    process.env.SF_TEST_LEAK = "leaked";
    const r = await run("echo leak=$" + "{SF_TEST_LEAK:-none}");
    delete process.env.SF_TEST_LEAK;
    expect(r.output).toContain("leak=none");
  });
});

describe("the machine's factor home", () => {
  const saved = process.env.FACTOR_HOME;
  afterEach(() => {
    if (saved === undefined) delete process.env.FACTOR_HOME;
    else process.env.FACTOR_HOME = saved;
  });

  it("falls back to the home folder when the variable is empty", () => {
    process.env.FACTOR_HOME = "";
    expect(factorHome()).toBe(join(homedir(), ".factor"));
  });

  it("is always an absolute path", () => {
    process.env.FACTOR_HOME = "relative/place";
    expect(isAbsolute(factorHome())).toBe(true);
  });
});
