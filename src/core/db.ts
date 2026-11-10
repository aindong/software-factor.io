// The factory's record: tasks, runs, lanes, gate results, the inbox. One SQLite file per workspace,
// through Node's built-in driver (ADR 0002).
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Each entry runs once, in order. Never edit one that has shipped: add another.
const MIGRATIONS = [
  `
  create table tasks (
    id integer primary key,
    collector text not null,
    key text not null,
    title text not null,
    body text not null default '',
    status text not null default 'queued',
    created_at text not null,
    unique (collector, key)
  );
  create table runs (
    id text primary key,
    task_id integer not null references tasks(id),
    workflow text not null,
    status text not null,
    stop_reason text,
    base_commit text not null,
    head_commit text,
    branch text not null,
    worktree text not null,
    pid integer,
    started_at text not null,
    ended_at text
  );
  create table lane_runs (
    id integer primary key,
    run_id text not null references runs(id),
    lane text not null,
    seq integer not null,
    outcome text,
    note text,
    handoff_path text,
    started_at text not null,
    ended_at text
  );
  create table gate_results (
    id integer primary key,
    run_id text not null references runs(id),
    lane_run_id integer not null references lane_runs(id),
    gate text not null,
    uses text not null,
    command text,
    exit_code integer,
    status text not null,
    tree_hash text not null,
    output_path text not null,
    output_sha256 text not null,
    duration_ms integer not null,
    started_at text not null
  );
  create table inbox (
    id integer primary key,
    run_id text not null references runs(id),
    lane text not null,
    kind text not null,
    body text not null,
    status text not null default 'open',
    answer text,
    created_at text not null,
    answered_at text
  );
  create table events (
    id integer primary key,
    run_id text,
    at text not null,
    kind text not null,
    data text not null default '{}'
  );
  `,
];

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // the wait comes first: two commands starting at once must queue, not fail
  db.exec("pragma busy_timeout = 5000");
  db.exec("pragma journal_mode = wal; pragma foreign_keys = on;");
  db.exec("begin immediate");
  try {
    const row = db.prepare("pragma user_version").get() as { user_version: number };
    for (let v = row.user_version; v < MIGRATIONS.length; v++) {
      db.exec(MIGRATIONS[v] ?? "");
      db.exec(`pragma user_version = ${v + 1}`);
    }
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
  return db;
}

export const now = () => new Date().toISOString();
