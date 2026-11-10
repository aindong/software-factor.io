// A throwaway git repository and a way to call the command against it, for acceptance tests.
import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
  // these tests are about one gate and no approval: trim the starter workflow to that
  const starter = repo.json<{ lanes: { checkpoint: string; gates: string[] }[] }>(
    ".factor/workflows/starter.json",
  );
  for (const lane of starter.lanes) Object.assign(lane, { checkpoint: "near", gates: ["verify"] });
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
  /** Files committed to the repository before the first run, by path. */
  files?: Record<string, string>;
  /** Extra keys for .factor/factory.json, such as protectedPaths. */
  factory?: Json;
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
    `${JSON.stringify({ version: 1, workflow: "starter", commands, ...o.factory }, null, 2)}\n`,
  );
  for (const [path, content] of Object.entries(o.files ?? {})) {
    mkdirSync(dirname(join(repo.dir, path)), { recursive: true });
    repo.write(path, content);
  }
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

/** The text of the evidence file of each gate result, in order. */
export const evidenceOf = (repo: Repo) =>
  repo
    .rows<{ output_path: string }>("select output_path from gate_results order by id")
    .map((g) => readFileSync(join(repo.dir, g.output_path), "utf8"));
/** A fixture "test runner": each t/*.test.sh that exits 0 is a passing test. It prints the counts. */
export const RUNNER = `#!/bin/sh
pass=0; fail=0
for t in t/*.test.sh; do
  [ -f "$t" ] || continue
  if sh "$t" >/dev/null 2>&1; then pass=$((pass+1)); else fail=$((fail+1)); fi
done
echo "# pass $pass"
echo "# fail $fail"
[ "$fail" -eq 0 ]
`;

/** Start the command without waiting for it, for tests where two things must happen at once. */
export function background(
  repo: Repo,
  ...args: string[]
): { child: ChildProcess; exit: Promise<number | null> } {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: repo.dir,
    env: { ...process.env, FACTOR_HOME: repo.home, NO_COLOR: "1", ...repo.env },
    stdio: "ignore",
  });
  return { child, exit: new Promise((done) => child.on("exit", (code) => done(code))) };
}

/** Wait until `check` is true, looking every 100 ms, for at most `ms`. */
export async function until(check: () => boolean, ms = 10_000): Promise<boolean> {
  for (let waited = 0; waited < ms; waited += 100) {
    try {
      if (check()) return true;
    } catch {
      // the database may not exist yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
export const alive = (name: string) => spawnSync("pgrep", ["-f", name]).status === 0;
/** A sleep no other process uses, so a leftover cannot be mistaken for this test's. */
export const uniqueNap = (seconds: number) =>
  `sleep ${seconds}.${process.pid}${Math.floor(Math.random() * 1e6)}`;

// ---- real adapters, against stand-in CLIs

const STANDINS = resolve("test/fixtures/bin");

export interface Profile {
  dir: string;
  /** How the stand-in was called, one entry per start. */
  calls: () => { argv: string[]; cwd: string; stdin: string; env: Record<string, string> }[];
}

/** Add an account whose binary is a stand-in, with a profile folder that tells the stand-in what to do. */
export function standinAccount(
  repo: Repo,
  name: string,
  kind: "claude" | "codex" | "kimi",
  plan: Json,
  extra: string[] = [],
): Profile {
  const dir = join(repo.home, "profiles", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "standin.json"), JSON.stringify(plan));
  const bin = join(STANDINS, kind);
  const r = repo.sf("account", "add", name, "--agent", kind, "--profile", dir, "--bin", bin, ...extra);
  if (r.status !== 0) throw new Error(`account add failed: ${r.stdout}${r.stderr}`);
  return {
    dir,
    calls: () => {
      try {
        return readFileSync(join(dir, "calls.jsonl"), "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    },
  };
}

/** What the run's hooks answered to each tool call the stand-in asked about. */
export const hooksOf = (profile: Profile): { tool: string; status: number; stderr: string }[] =>
  readFileSync(join(profile.dir, "hooks.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
/** Whether the stand-in's own process is still there. */
export function standinAlive(profile: Profile): boolean {
  try {
    process.kill(Number(readFileSync(join(profile.dir, "pid"), "utf8")), 0);
    return true;
  } catch {
    return false;
  }
}

/** Bind a role of the workspace to an account. */
export function bind(repo: Repo, role: string, account: string, ...extra: string[]): void {
  const r = repo.sf("role", "bind", role, "--account", account, ...extra);
  if (r.status !== 0) throw new Error(`role bind failed: ${r.stdout}${r.stderr}`);
}
/** The value that follows a flag in a recorded command line. */
export const flag = (argv: string[], name: string) =>
  argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;

// ---- the factor MCP server

export interface ToolAnswer {
  result?: { content: { type: string; text: string }[]; isError?: boolean };
  error?: { code: number; message: string };
}
/** What the server answered to each tool call the stand-in made. */
export const mcpOf = (profile: Profile): { tool: string; answer?: ToolAnswer }[] => {
  try {
    return readFileSync(join(profile.dir, "mcp.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};

/** Speak to `softwarefactor mcp` directly: send these messages, get every answer back. */
export function mcp(
  repo: Repo,
  lane: { run: string; lane: string; laneDir?: string; account?: string },
  messages: unknown[],
): {
  answers: (ToolAnswer & { id: number | null; result?: Record<string, unknown> })[];
  status: number | null;
  stderr: string;
} {
  const laneDir = lane.laneDir ?? join(repo.home, "lane");
  mkdirSync(join(laneDir, "evidence"), { recursive: true });
  const args = [
    "mcp",
    "--workspace",
    repo.dir,
    "--run",
    lane.run,
    "--lane",
    lane.lane,
    "--lane-dir",
    laneDir,
  ];
  if (lane.account) args.push("--account", lane.account);
  const input = messages.map((m) => (typeof m === "string" ? m : JSON.stringify(m))).join("\n");
  const r = spawnSync(process.execPath, [CLI, ...args], {
    input: `${input}\n`,
    encoding: "utf8",
    env: { ...process.env, FACTOR_HOME: repo.home },
  });
  const answers = r.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return { answers, status: r.status, stderr: r.stderr };
}
/** Call one tool of the server, and return its answer. */
export function callTool(
  repo: Repo,
  lane: { run: string; lane: string; laneDir?: string; account?: string },
  name: string,
  args: Json = {},
): ToolAnswer {
  const call = { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } };
  return mcp(repo, lane, [call]).answers.find((a) => a.id === 7) ?? {};
}
/** The prompts every run of the workspace gave a lane, by run in the order the runs started. */
export function promptsByRun(repo: Repo, lane: string): string[][] {
  return repo.rows<{ id: string }>("select id from runs order by started_at, rowid").map((run) => {
    const dir = join(repo.dir, ".factor/runs", run.id, "prompts");
    return readdirSync(dir)
      .filter((f) => new RegExp(`^\\d+-${lane}(\\.\\d+)?\\.md$`).test(f))
      .sort()
      .map((f) => readFileSync(join(dir, f), "utf8"));
  });
}

// ---- panels

/** A read-only lane worked by a panel of the reviewer role. Anything in `extra` wins. */
export function panelLane(members: Json[], extra: Json = {}): Json {
  const { join: joinBy = "all", ...rest } = extra as { join?: string };
  return agentLane("review", {
    agent: { role: "reviewer", access: "read", prompt: "Review the change." },
    panel: { join: joinBy, members },
    ...rest,
  });
}
/** Change the workflow a test built, before the first run. */
export function editWorkflow(repo: Repo, change: (workflow: Record<string, Json>) => void): void {
  const path = ".factor/workflows/starter.json";
  const workflow = repo.json<Record<string, Json>>(path);
  change(workflow);
  repo.write(path, `${JSON.stringify(workflow, null, 2)}\n`);
}
/** The sessions of the workspace, oldest first. */
export const sessionRows = (repo: Repo, columns = "lane, tokens") =>
  repo.rows<Record<string, unknown>>(`select ${columns} from sessions order by id`);
