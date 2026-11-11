import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo } from "../helpers/repo.ts";

// Plan: docs/plans/version-command.md, criteria 1 to 6.
const { version } = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { version: string };

/** A folder that is no git repository, with no factory in it. */
const bare = () => realpathSync(mkdtempSync(join(tmpdir(), "sf-bare-")));

const call = (cwd: string, args: string[], script = resolve("src/cli.ts"), env = {}) => {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FACTOR_HOME: join(cwd, "home"), NO_COLOR: "1", ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

describe("softwarefactor --version", () => {
  it.each([["--version"], ["version"]])(
    "prints the version from package.json on one line with `%s` (1, 2)",
    (word) => {
      const r = call(bare(), [word]);
      expect(r.stderr).toBe("");
      expect(r.stdout).toBe(`${version}\n`);
      expect(r.status).toBe(0);
    },
  );

  it("works inside a git repository with a factory too (3)", () => {
    const repo = makeRepo();
    repo.sf("init");
    expect(repo.sf("--version").stdout).toBe(`${version}\n`);
    expect(repo.sf("version").status).toBe(0);
  });

  it("works from inside a run, where only commands that look are allowed (4)", () => {
    const r = call(bare(), ["version"], resolve("src/cli.ts"), { FACTOR_RUN_ID: "r1" });
    expect(r.stdout).toBe(`${version}\n`);
    expect(r.status).toBe(0);
  });

  it("is listed in the help (5)", () => {
    const r = call(bare(), ["--help"]);
    expect(r.stdout).toMatch(/\n {2}version\s+\S/);
    expect(r.stdout).toContain("--version");
  });

  it("prints the version of the package.json beside the built command (6)", () => {
    // build into <pkg>/dist, as `pnpm build` does, with a package.json of its own beside it
    const pkg = realpathSync(mkdtempSync(join(tmpdir(), "sf-pkg-")));
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({ name: "softwarefactor", version: "7.8.9", type: "module" }),
    );
    mkdirSync(join(pkg, "dist"));
    symlinkSync(resolve("node_modules"), join(pkg, "node_modules"));
    const tsc = spawnSync(
      process.execPath,
      [
        resolve("node_modules/typescript/bin/tsc"),
        "-p",
        resolve("tsconfig.build.json"),
        "--outDir",
        join(pkg, "dist"),
      ],
      { encoding: "utf8" },
    );
    expect(tsc.stdout + tsc.stderr).toBe("");
    for (const word of ["--version", "version"]) {
      const r = call(bare(), [word], join(pkg, "dist", "cli.js"));
      expect(r.stderr).toBe("");
      expect(r.stdout).toBe("7.8.9\n");
      expect(r.status).toBe(0);
    }
  }, 120_000);
});
