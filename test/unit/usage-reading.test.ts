// Reading what a login's CLI says of its limits: `claude -p /usage` prints one line for each window,
// such as "Current week (all models): 73% used · resets Nov 15 at 6:59am (Asia/Manila)".
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseUsage, readAccountLimits } from "../../src/core/limits.ts";

const PRINTED = [
  "Current session: 12% used · resets 3pm (Asia/Manila)",
  "Current week (all models): 73% used · resets Nov 15 at 6:59am (Asia/Manila)",
  "Current week (Fable): 80% used · resets Nov 15 at 7am (Asia/Manila)",
].join("\n");

/** A stand-in CLI: a shell script that prints `out` and `err` and ends with `code`. */
function cli(out: string, err: string, code: number): { bin: string; profile: string } {
  const dir = mkdtempSync(join(tmpdir(), "sf-usage-"));
  const bin = join(dir, "claude");
  writeFileSync(join(dir, "out.txt"), out);
  writeFileSync(join(dir, "err.txt"), err);
  writeFileSync(
    bin,
    `#!/bin/sh\nhere=$(dirname "$0")\necho "$*" >> "$here/args.txt"\ncat "$here/out.txt"\ncat "$here/err.txt" >&2\nexit ${code}\n`,
  );
  chmodSync(bin, 0o755);
  return { bin, profile: dir };
}
const argsOf = (profile: string) =>
  existsSync(join(profile, "args.txt")) ? readFileSync(join(profile, "args.txt"), "utf8") : "";

describe("the usage text of Claude Code", () => {
  it("gives each window its name, the percent used and when it resets", () => {
    expect(parseUsage(PRINTED)).toEqual([
      { name: "Current session", percent: 12, resets: "3pm (Asia/Manila)" },
      { name: "Current week (all models)", percent: 73, resets: "Nov 15 at 6:59am (Asia/Manila)" },
      { name: "Current week (Fable)", percent: 80, resets: "Nov 15 at 7am (Asia/Manila)" },
    ]);
  });

  it("passes over a line it does not know", () => {
    const text = [
      "Usage for this login",
      "Current week (all models): 73% used · resets Nov 15 at 6:59am (Asia/Manila)",
      "Extra usage: off",
      "Current month (credits): $4.00 spent",
    ].join("\n");
    const windows = parseUsage(text);
    expect(windows.map((w) => w.name)).not.toContain("Extra usage");
    expect(windows.map((w) => w.name).join(" ")).not.toMatch(/month|credits|Usage for/);
    expect(windows.find((w) => w.name === "Current week (all models)")).toEqual({
      name: "Current week (all models)",
      percent: 73,
      resets: "Nov 15 at 6:59am (Asia/Manila)",
    });
  });

  it("says a window the text does not print is not reported, never 0", () => {
    const windows = parseUsage("Current week (all models): 73% used · resets Nov 15 at 6:59am (Asia/Manila)");
    const session = windows.find((w) => w.name === "Current session");
    expect(session).toEqual({ name: "Current session", percent: null, resets: null });
    // a week for one named model is expected, and is not reported here either
    expect(windows.filter((w) => /^Current week \((?!all models)/.test(w.name))).toEqual([
      expect.objectContaining({ percent: null, resets: null }),
    ]);
  });

  it("says a percent over 100 is not reported, never a number the CLI cannot mean", () => {
    const windows = parseUsage("Current session: 130% used · resets 3pm (Asia/Manila)");
    expect(windows.find((w) => w.name === "Current session")).toEqual({
      name: "Current session",
      percent: null,
      resets: null,
    });
  });

  it("gives every window as not reported for text with no window in it", () => {
    for (const text of ["", "Not a usage page.\nNothing here."]) {
      const windows = parseUsage(text);
      expect(windows.length).toBeGreaterThanOrEqual(3);
      expect(windows.every((w) => w.percent === null && w.resets === null)).toBe(true);
      expect(windows.map((w) => w.name)).toEqual(
        expect.arrayContaining(["Current session", "Current week (all models)"]),
      );
    }
  });
});

describe("reading a login's limits", () => {
  it("reads the windows the CLI prints, with the time of the reading", async () => {
    const before = Date.now();
    const login = cli(PRINTED, "", 0);
    const reading = await readAccountLimits({ agent: "claude", ...login });
    // the usage page alone, in print mode: no prompt that the model would answer
    expect(argsOf(login.profile)).toBe("-p /usage\n");
    expect(reading.failed).toBeNull();
    expect(reading.windows.find((w) => w.name === "Current week (Fable)")?.percent).toBe(80);
    expect(Date.parse(reading.at)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(reading.at)).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("gives the reason when the CLI fails, and no window", async () => {
    const reading = await readAccountLimits({
      agent: "claude",
      ...cli("", "Not logged in · Please run /login\n", 1),
    });
    expect(reading.failed).toMatch(/Not logged in/);
    expect(reading.failed).toMatch(/1/);
    expect(reading.windows).toEqual([]);
  });

  it("keeps a path that is not the login's own out of the reason", async () => {
    const reading = await readAccountLimits({
      agent: "claude",
      ...cli("", "Error: ENOENT /Users/someone/.claude.json\n    at /Users/someone/src/cli.js:3\n", 1),
    });
    expect(reading.failed).toMatch(/ENOENT/);
    expect(reading.failed).not.toMatch(/\/Users|someone/);
  });

  it("gives the CLI's words when it ends well but prints no window, and every window as not reported", async () => {
    for (const [stdout, said] of [
      ["Not logged in · Please run /login\n", /Not logged in/],
      ["", /printed no limits/],
    ] as const) {
      const reading = await readAccountLimits({ agent: "claude", ...cli(stdout, "", 0) });
      expect(reading.failed).toMatch(said);
      expect(reading.windows).toEqual(parseUsage(""));
    }
  });

  it("gives the reason when the CLI cannot be started", async () => {
    const reading = await readAccountLimits({
      agent: "claude",
      profile: tmpdir(),
      bin: join(tmpdir(), "no-such-cli-here"),
    });
    expect(reading.failed).toMatch(/could not be started|not found/i);
    expect(reading.windows).toEqual([]);
  });

  it("says in plain words that Codex reports nothing without a model call, and starts nothing", async () => {
    const { bin, profile } = cli("Current session: 99% used · resets 3pm", "", 0);
    const reading = await readAccountLimits({ agent: "codex", profile, bin });
    expect(reading.windows).toEqual([]);
    expect(reading.failed).toBeNull();
    expect(reading.none).toMatch(/Codex/);
    expect(reading.none).toMatch(/model call/);
    expect(argsOf(profile)).toBe("");
  });
});
