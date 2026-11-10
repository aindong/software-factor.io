// A workspace whose record is written by hand, for the cost report: tasks, runs and sessions with
// exactly the numbers a test names. And an account whose CLI prints exactly the lines it is given.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentLane, bind, flowRepo, type Repo } from "./repo.ts";
import { sql } from "./runs.ts";

export interface Used {
  lane?: string;
  account?: string | null;
  agent?: string;
  model?: string | null;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** Null for a cost that is not known. */
  usd?: number | null;
}
export interface Ledger {
  repo: Repo;
  task: (title: string, status: string) => number;
  run: (task: number, id: string, status: string, stopCode?: string) => string;
  session: (run: string, used: Used) => void;
}

export function ledger(): Ledger {
  const repo = flowRepo({ lanes: [agentLane("build")] });
  if (repo.sf("run").status !== 0) throw new Error("the first run did not end done");
  // the tables are there now: the test's own rows take the place of that run's
  sql(repo, (db) => {
    db.exec("pragma foreign_keys = off");
    for (const table of ["sessions", "gate_results", "lane_runs", "inbox", "runs", "tasks"])
      db.exec(`delete from ${table}`);
  });
  const at = "2026-11-10T10:00:00.000Z";
  return {
    repo,
    task: (title, status) => {
      let id = 0;
      sql(repo, (db) => {
        const made = db
          .prepare(
            "insert into tasks (collector, key, title, status, created_at) values ('tasks', ?, ?, ?, ?)",
          )
          .run(title, title, status, at);
        id = Number(made.lastInsertRowid);
      });
      return id;
    },
    run: (task, id, status, stopCode) => {
      sql(repo, (db) => {
        db.prepare(
          "insert into runs (id, task_id, workflow, status, stop_code, base_commit, branch, worktree, started_at) values (?, ?, 'starter', ?, ?, 'base', ?, ?, ?)",
        ).run(id, task, status, stopCode ?? null, `factor/${id}`, `/nowhere/${id}`, at);
      });
      return id;
    },
    session: (run, used) => {
      const lane = used.lane ?? "build";
      const kinds = [used.input ?? 0, used.output ?? 0, used.cacheRead ?? 0, used.cacheWrite ?? 0];
      sql(repo, (db) => {
        db.exec("pragma foreign_keys = off"); // a session may name a run that is no longer in the record
        const laneRun = db
          .prepare("insert into lane_runs (run_id, lane, seq, started_at) values (?, ?, 1, ?)")
          .run(run, lane, at);
        db.prepare(
          "insert into sessions (run_id, lane_run_id, lane, try, account, agent, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tokens, usd, usd_source, started_at, duration_ms) values (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
        ).run(
          run,
          Number(laneRun.lastInsertRowid),
          lane,
          used.account === undefined ? "work" : used.account,
          used.agent ?? "claude",
          used.model === undefined ? "claude-sonnet-5-5" : used.model,
          ...kinds,
          kinds.reduce((sum, n) => sum + n, 0),
          used.usd === undefined ? 0.01 : used.usd,
          used.usd === null ? "unknown" : "reported",
          at,
        );
      });
    },
  };
}

/** The lines of one section of the printed report, without its heading. */
export function section(printed: string, heading: string): string[] {
  const lines = printed.split("\n");
  const from = lines.findIndex((line) => line.startsWith(heading));
  if (from < 0) return [];
  const rest = lines.slice(from + 1);
  const to = rest.findIndex((line) => !line.startsWith(" "));
  return to < 0 ? rest : rest.slice(0, to);
}

/** An account whose CLI prints exactly these lines, whatever it is asked. Bound to the role `author`. */
export function printingAccount(repo: Repo, kind: "claude" | "codex", lines: unknown[]): void {
  const profile = join(repo.home, "profiles", "printing");
  mkdirSync(profile, { recursive: true });
  const bin = join(repo.home, "printing-cli");
  const print = lines.map((l) => `printf '%s\\n' '${JSON.stringify(l)}'`).join("\n");
  writeFileSync(bin, `#!/bin/sh\ncat > /dev/null\n${print}\n`, { mode: 0o755 });
  const added = repo.sf("account", "add", "printing", "--agent", kind, "--profile", profile, "--bin", bin);
  if (added.status !== 0) throw new Error(added.stderr);
  bind(repo, "author", "printing", ...(kind === "codex" ? ["--medium", "gpt-5.3-codex"] : []));
}
