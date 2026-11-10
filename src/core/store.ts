// Every read and write of the factory's record goes through here, so the engine, the command line
// and later the interface share one set of operations (ADR 0008).
import { type Db, now } from "./db.ts";

export type TaskStatus = "queued" | "running" | "waiting" | "done" | "dropped" | "stopped";
export type RunStatus = "running" | "waiting" | "done" | "dropped" | "stopped";
export type Outcome = "pass" | "fail" | "needsPerson";

export interface Task {
  id: number;
  collector: string;
  key: string;
  title: string;
  body: string;
  status: TaskStatus;
}
export interface Run {
  id: string;
  task_id: number;
  workflow: string;
  status: RunStatus;
  stop_code: string | null;
  stop_reason: string | null;
  base_commit: string;
  head_commit: string | null;
  branch: string;
  worktree: string;
  wake_at: string | null;
  /** The run's position and counters, as JSON (engine/state.ts). */
  state: string;
}
export interface GateRecord {
  gate: string;
  uses: string;
  command: string | null;
  exit_code: number | null;
  status: "pass" | "fail";
  tree_hash: string;
  output_path: string;
  output_sha256: string;
  duration_ms: number;
  /** 1 for the first check of a lane's work, 2 and up after repairs. */
  attempt: number;
}
export interface InboxItem {
  id: number;
  run_id: string;
  lane: string;
  kind: "approval" | "question";
  body: string;
  status: string;
}

/** Adds a task the first time a collector sees it. A task already known keeps its status. */
export function addTask(db: Db, t: { collector: string; key: string; title: string; body: string }): boolean {
  const r = db
    .prepare("insert or ignore into tasks (collector, key, title, body, created_at) values (?, ?, ?, ?, ?)")
    .run(t.collector, t.key, t.title, t.body, now());
  return r.changes > 0;
}

/** Takes the oldest queued task for this process, or nothing. The claim comes before any work starts (ADR 0013). */
export function claimNextTask(db: Db): Task | undefined {
  db.exec("begin immediate");
  try {
    const task = db.prepare("select * from tasks where status = 'queued' order by id limit 1").get() as
      | Task
      | undefined;
    if (task)
      db.prepare("update tasks set status = 'running' where id = ? and status = 'queued'").run(task.id);
    db.exec("commit");
    return task ? { ...task, status: "running" } : undefined;
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}

export const getTask = (db: Db, id: number) =>
  db.prepare("select * from tasks where id = ?").get(id) as Task | undefined;
export const getRun = (db: Db, id: string) =>
  db.prepare("select * from runs where id = ?").get(id) as Run | undefined;

export function setTaskStatus(db: Db, id: number, status: TaskStatus): void {
  db.prepare("update tasks set status = ? where id = ?").run(status, id);
}

export function createRun(
  db: Db,
  r: Pick<Run, "id" | "task_id" | "workflow" | "base_commit" | "branch" | "worktree" | "state">,
): void {
  db.prepare(
    "insert into runs (id, task_id, workflow, status, base_commit, branch, worktree, state, pid, started_at) values (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)",
  ).run(r.id, r.task_id, r.workflow, r.base_commit, r.branch, r.worktree, r.state, process.pid, now());
}

export function setRunHead(db: Db, id: string, head: string): void {
  db.prepare("update runs set head_commit = ? where id = ?").run(head, id);
}

export function saveState(db: Db, id: string, state: unknown): void {
  db.prepare("update runs set state = ? where id = ?").run(JSON.stringify(state), id);
}

/** Ends a run, or parks it as waiting. `code` is the reason as a word that can be counted. */
export function endRun(
  db: Db,
  id: string,
  status: RunStatus,
  code: string,
  reason: string,
  wakeAt: string | null = null,
): void {
  const ended = status === "waiting" ? null : now();
  db.prepare(
    "update runs set status = ?, stop_code = ?, stop_reason = ?, wake_at = ?, ended_at = ?, pid = null where id = ?",
  ).run(status, code, reason, wakeAt, ended, id);
}

/** A waiting run starts moving again in this process. */
export function resumeRun(db: Db, id: string): void {
  db.prepare(
    "update runs set status = 'running', stop_code = null, stop_reason = null, wake_at = null, pid = ? where id = ?",
  ).run(process.pid, id);
}

/** Runs parked on a wait lane whose time has come. */
export const dueRuns = (db: Db) =>
  db
    .prepare(
      "select * from runs where status = 'waiting' and stop_code = 'waiting' and wake_at <= ? order by wake_at",
    )
    .all(now()) as unknown as Run[];

export function startLane(db: Db, runId: string, lane: string, seq: number): number {
  const r = db
    .prepare("insert into lane_runs (run_id, lane, seq, started_at) values (?, ?, ?, ?)")
    .run(runId, lane, seq, now());
  return Number(r.lastInsertRowid);
}

export function endLane(
  db: Db,
  id: number,
  outcome: Outcome,
  note: string,
  handoffPath: string | null,
  cost: { attempts?: number; tokens?: number; usd?: number; durationMs?: number } = {},
): void {
  db.prepare(
    "update lane_runs set outcome = ?, note = ?, handoff_path = ?, attempts = ?, tokens = ?, usd = ?, duration_ms = ?, ended_at = ? where id = ?",
  ).run(
    outcome,
    note,
    handoffPath,
    cost.attempts ?? 1,
    cost.tokens ?? 0,
    cost.usd ?? 0,
    cost.durationMs ?? 0,
    now(),
    id,
  );
}

/** A person overruled a lane's outcome. */
export function setLaneOutcome(db: Db, id: number, outcome: Outcome, note: string): void {
  db.prepare("update lane_runs set outcome = ?, note = ? where id = ?").run(outcome, note, id);
}

export function addGateResult(db: Db, runId: string, laneRunId: number, g: GateRecord): void {
  db.prepare(
    `insert into gate_results (run_id, lane_run_id, gate, uses, command, exit_code, status, tree_hash, output_path, output_sha256, duration_ms, attempt, started_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runId,
    laneRunId,
    g.gate,
    g.uses,
    g.command,
    g.exit_code,
    g.status,
    g.tree_hash,
    g.output_path,
    g.output_sha256,
    g.duration_ms,
    g.attempt,
    now(),
  );
}

export function addInbox(
  db: Db,
  runId: string,
  lane: string,
  kind: "approval" | "question",
  body: string,
): void {
  db.prepare("insert into inbox (run_id, lane, kind, body, created_at) values (?, ?, ?, ?, ?)").run(
    runId,
    lane,
    kind,
    body,
    now(),
  );
}

export const openInbox = (db: Db) =>
  db
    .prepare(
      "select inbox.*, tasks.title from inbox join runs on runs.id = inbox.run_id join tasks on tasks.id = runs.task_id where inbox.status = 'open' order by inbox.id",
    )
    .all() as unknown as (InboxItem & { title: string })[];

export const openInboxFor = (db: Db, runId: string) =>
  db
    .prepare("select * from inbox where run_id = ? and status = 'open' order by id desc limit 1")
    .get(runId) as InboxItem | undefined;

export function closeInbox(
  db: Db,
  id: number,
  status: "approved" | "rejected" | "sent_back" | "answered",
  note: string,
): void {
  db.prepare("update inbox set status = ?, answer = ?, answered_at = ? where id = ?").run(
    status,
    note,
    now(),
    id,
  );
}

export function addEvent(
  db: Db,
  runId: string | null,
  kind: string,
  data: Record<string, unknown> = {},
): void {
  db.prepare("insert into events (run_id, at, kind, data) values (?, ?, ?, ?)").run(
    runId,
    now(),
    kind,
    JSON.stringify(data),
  );
}

export interface StatusView {
  tasks: Task[];
  runs: (Run & {
    title: string;
    lanes: { lane: string; outcome: Outcome | null; note: string | null; gates: GateRecord[] }[];
    inbox: { kind: string; body: string }[];
  })[];
}

export function readStatus(db: Db): StatusView {
  const tasks = db.prepare("select * from tasks order by id").all() as unknown as Task[];
  const runs = db
    .prepare(
      "select runs.*, tasks.title from runs join tasks on tasks.id = runs.task_id order by runs.started_at",
    )
    .all() as unknown as (Run & { title: string })[];
  return {
    tasks,
    runs: runs.map((run) => {
      const lanes = db
        .prepare("select id, lane, outcome, note from lane_runs where run_id = ? order by seq, id")
        .all(run.id) as unknown as {
        id: number;
        lane: string;
        outcome: Outcome | null;
        note: string | null;
      }[];
      return {
        ...run,
        lanes: lanes.map((l) => ({
          lane: l.lane,
          outcome: l.outcome,
          note: l.note,
          gates: db
            .prepare("select * from gate_results where lane_run_id = ? order by id")
            .all(l.id) as unknown as GateRecord[],
        })),
        inbox: db
          .prepare("select kind, body from inbox where run_id = ? and status = 'open'")
          .all(run.id) as unknown as {
          kind: string;
          body: string;
        }[],
      };
    }),
  };
}
