// A throwaway git repository and a way to call the command against it, for acceptance tests.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const CLI = resolve("src/cli.ts");

export interface Repo {
  dir: string;
  /** A private FACTOR_HOME, so tests never touch the real one. */
  home: string;
  git: (...args: string[]) => string;
  sf: (...args: string[]) => { status: number | null; stdout: string; stderr: string };
  read: (path: string) => string;
  write: (path: string, content: string) => void;
  json: <T = Record<string, unknown>>(path: string) => T;
  /** Rows of a query against the workspace's state database. */
  rows: <T = Record<string, unknown>>(sql: string) => T[];
}

export function makeRepo(): Repo {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sf-repo-")));
  const home = realpathSync(mkdtempSync(join(tmpdir(), "sf-home-")));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  git("add", "-A");
  git("commit", "-q", "-m", "initial");
  const repo: Repo = {
    dir,
    home,
    git,
    sf: (...args) => {
      const r = spawnSync(process.execPath, [CLI, ...args], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, FACTOR_HOME: home, NO_COLOR: "1" },
      });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    },
    read: (path) => readFileSync(join(dir, path), "utf8"),
    write: (path, content) => writeFileSync(join(dir, path), content),
    json: (path) => JSON.parse(readFileSync(join(dir, path), "utf8")),
    rows: (sql) => {
      const db = new DatabaseSync(join(dir, ".factor/state.db"), { readOnly: true });
      try {
        return db.prepare(sql).all() as never;
      } finally {
        db.close();
      }
    },
  };
  return repo;
}

/** An initialised repository with one open task, a verify command and a script for the fake agent. */
export function readyRepo(options: { verify: string; script: unknown[]; task?: string }): Repo {
  const repo = makeRepo();
  const init = repo.sf("init");
  if (init.status !== 0) throw new Error(`init failed: ${init.stdout}${init.stderr}`);
  const factory = repo.json<{ commands: Record<string, string> }>(".factor/factory.json");
  factory.commands.verify = options.verify;
  repo.write(".factor/factory.json", `${JSON.stringify(factory, null, 2)}\n`);
  repo.write(
    ".factor/local.json",
    `${JSON.stringify({ roles: { author: { adapter: "fake", script: { "*": options.script } } } }, null, 2)}\n`,
  );
  repo.write(
    ".factor/tasks.md",
    `# Tasks\n\n- [ ] ${options.task ?? "Add a greeting file"}\n  Create hello.txt with one line.\n`,
  );
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "set up the factory");
  return repo;
}

export const passingScript = [
  { write: { path: "hello.txt", content: "hello\n" } },
  { commit: "Add a greeting file" },
  { handoff: { outcome: "pass", summary: "Added hello.txt." } },
];
