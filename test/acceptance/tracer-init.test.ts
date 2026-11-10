import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkflow } from "../../src/core/schema/parse.ts";
import { makeRepo } from "../helpers/repo.ts";

describe("softwarefactor init", () => {
  const repo = makeRepo();
  const first = repo.sf("init");

  it("creates the factory's files", () => {
    expect(first.status, first.stderr).toBe(0);
    for (const f of [
      ".factor/factory.json",
      ".factor/workflows/starter.json",
      ".factor/tasks.md",
      ".factor/local.json",
    ]) {
      expect(existsSync(join(repo.dir, f)), f).toBe(true);
    }
    const factory = repo.json<{ workflow: string; commands: Record<string, string> }>(".factor/factory.json");
    expect(factory.workflow).toBe("starter");
    expect(typeof factory.commands.verify).toBe("string");
  });

  it("writes a workflow that passes the checker", () => {
    const result = parseWorkflow(repo.json(".factor/workflows/starter.json"));
    expect(result.problems).toEqual([]);
    expect(result.workflow?.name).toBe("starter");
  });

  it("keeps the database, run files and machine bindings out of git", () => {
    for (const f of [
      ".factor/state.db",
      ".factor/state.db-wal",
      ".factor/runs/abc/evidence/x.log",
      ".factor/local.json",
    ]) {
      const r = spawnSync("git", ["check-ignore", "-q", f], { cwd: repo.dir });
      expect(r.status, `${f} is not ignored`).toBe(0);
    }
    const tracked = spawnSync("git", ["check-ignore", "-q", ".factor/factory.json"], { cwd: repo.dir });
    expect(tracked.status, ".factor/factory.json must not be ignored").toBe(1);
  });

  it("changes nothing the second time, even files the person has edited, and says so", () => {
    repo.write(".factor/tasks.md", "# Tasks\n\n- [ ] mine\n");
    repo.write(".factor/local.json", '{"roles":{}}\n');
    const files = [
      ".factor/factory.json",
      ".factor/workflows/starter.json",
      ".factor/tasks.md",
      ".factor/local.json",
      ".gitignore",
    ];
    const before = files.map((f) => repo.read(f));
    const second = repo.sf("init");
    expect(second.status).toBe(0);
    expect(second.stdout).toMatch(/already/i);
    expect(files.map((f) => repo.read(f))).toEqual(before);
  });

  it("refuses outside a git repository, with a way forward", () => {
    const r = spawnSync(process.execPath, [join(process.cwd(), "src/cli.ts"), "init"], {
      cwd: repo.home,
      encoding: "utf8",
      env: { ...process.env, FACTOR_HOME: repo.home },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/git init/);
  });
});
