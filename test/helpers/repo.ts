// A throwaway git repository and a way to call the command against it, for acceptance tests.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const CLI = resolve("src/cli.ts");

export interface Repo {
  dir: string;
  /** A private FACTOR_HOME, so tests never touch the real one. */
  home: string;
  /** Extra environment for every call of the command, such as the test clock. */
  env: Record<string, string>;
  git: (...args: string[]) => string;
  sf: (...args: string[]) => { status: number | null; stdout: string; stderr: string };
  read: (path: string) => string;
  write: (path: string, content: string) => void;
  json: <T = Record<string, unknown>>(path: string) => T;
  /** Rows of a query against the workspace's state database. */
  rows: <T = Record<string, unknown>>(sql: string) => T[];
}

export function makeRepo(options: { commit?: boolean } = {}): Repo {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sf-repo-")));
  const home = realpathSync(mkdtempSync(join(tmpdir(), "sf-home-")));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  if (options.commit !== false) {
    git("add", "-A");
    git("commit", "-q", "-m", "initial");
  }
  const repo: Repo = {
    dir,
    home,
    env: {},
    git,
    sf: (...args) => {
      const r = spawnSync(process.execPath, [CLI, ...args], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, FACTOR_HOME: home, NO_COLOR: "1", ...repo.env },
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
  const starter = repo.json<{ lanes: { checkpoint: string }[] }>(".factor/workflows/starter.json");
  for (const lane of starter.lanes) lane.checkpoint = "near";
  repo.write(".factor/workflows/starter.json", `${JSON.stringify(starter, null, 2)}\n`);
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

// ---- workflows built in a test

type Json = Record<string, unknown>;
const write = (path: string, content = `${path}\n`) => ({ write: { path, content } });
/** Script steps: write a file and commit it. */
export const commitFile = (path: string, content?: string) => [
  write(path, content),
  { commit: `Add ${path}` },
];
export const pass = (extra: Json = {}) => ({ handoff: { outcome: "pass", summary: "ok", ...extra } });
export const fail = (summary: string) => ({ handoff: { outcome: "fail", summary } });

/** An agent lane with the settings most tests share. Anything in `extra` wins. */
export function agentLane(id: string, extra: Json = {}): Json {
  const { agent, ...rest } = extra as { agent?: Json };
  return {
    id,
    uses: "core/agent@1",
    agent: { role: "author", access: "read", prompt: `Do the ${id} step.`, ...agent },
    checkpoint: "out",
    on: { pass: "@done", fail: "@stop" },
    ...rest,
  };
}
export const commandLane = (id: string, run: string, extra: Json = {}): Json => ({
  id,
  uses: "core/command@1",
  with: { run },
  checkpoint: "out",
  on: { pass: "@done", fail: "@stop" },
  ...extra,
});

export interface FlowOptions {
  lanes: Json[];
  gates?: Json;
  /** Workspace commands: name to shell command. */
  commands?: Record<string, string>;
  /** What the scripted agent does: role, then lane id, then steps (or a list of step lists, one per entry). */
  scripts?: Record<string, Record<string, unknown>>;
  limits?: Json;
  tasks?: string;
}

/** An initialised repository running the given lanes, with one open task. */
export function flowRepo(o: FlowOptions): Repo {
  const repo = makeRepo();
  if (repo.sf("init").status !== 0) throw new Error("init failed");
  const commands = o.commands ?? { verify: "true" };
  const workflow = {
    $schema: "https://softwarefactor.io/schema/workflow/v1.json",
    version: 1,
    name: "starter",
    description: "A workflow built by a test.",
    roles: { author: { description: "Writes." }, reviewer: { description: "Reads." } },
    limits: o.limits ?? { minutes: 60, tokens: 1000000 },
    commands: Object.fromEntries(Object.keys(commands).map((c) => [c, { description: `The ${c} command.` }])),
    collectors: [{ id: "tasks", uses: "core/file@1", with: { path: ".factor/tasks.md" } }],
    gates: o.gates ?? { verify: { uses: "core/command@1", with: { command: "verify" }, onFail: "fail" } },
    lanes: o.lanes,
  };
  repo.write(".factor/workflows/starter.json", `${JSON.stringify(workflow, null, 2)}\n`);
  repo.write(
    ".factor/factory.json",
    `${JSON.stringify({ version: 1, workflow: "starter", commands }, null, 2)}\n`,
  );
  const roles = Object.fromEntries(
    // a lane with no script of its own just passes
    ["author", "reviewer"].map((r) => [r, { adapter: "fake", script: { "*": [pass()], ...o.scripts?.[r] } }]),
  );
  repo.write(".factor/local.json", `${JSON.stringify({ roles }, null, 2)}\n`);
  repo.write(".factor/tasks.md", o.tasks ?? "- [ ] Do the thing\n");
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "set up the factory");
  return repo;
}

/** The lanes a run went through, in order, as "lane:outcome". */
export const trail = (repo: Repo) =>
  repo
    .rows<{ lane: string; outcome: string }>("select lane, outcome from lane_runs order by id")
    .map((l) => `${l.lane}:${l.outcome}`);
export const runRow = (repo: Repo) =>
  repo.rows<{ id: string; status: string; stop_code: string; wake_at: string | null; state: string }>(
    "select * from runs",
  )[0];
/** The prompts a lane was given, in order. */
export function promptsOf(repo: Repo, lane: string): string[] {
  const run = runRow(repo);
  const dir = join(repo.dir, ".factor/runs", run?.id ?? "", "prompts");
  // "01-build.md" is the first prompt of that lane run and "01-build.2.md" the second
  const order = (f: string) => {
    const m = /^(\d+)-.*?(?:\.(\d+))?\.md$/.exec(f);
    return Number(m?.[1] ?? 0) * 1000 + Number(m?.[2] ?? 1);
  };
  return readdirSync(dir)
    .filter((f) => new RegExp(`^\\d+-${lane}(\\.\\d+)?\\.md$`).test(f))
    .sort((a, b) => order(a) - order(b))
    .map((f) => readFileSync(join(dir, f), "utf8"));
}
