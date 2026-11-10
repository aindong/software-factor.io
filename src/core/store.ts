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
  /** The slot the run holds while it is moving. */
  slot: number | null;
  /** The process that is moving the run, when one is. */
  pid: number | null;
  /** The run's risk as JSON, or null when no lane stated one. */
  risk: string | null;
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

/** This process takes a waiting run. False when another process took it first: a run has one owner at a time. */
export function takeWaitingRun(db: Db, id: string): boolean {
  const r = db
    .prepare(
      "update runs set status = 'running', stop_code = null, stop_reason = null, wake_at = null, stop_requested = 0, pid = ? where id = ? and status = 'waiting'",
    )
    .run(process.pid, id);
  return r.changes === 1;
}

/** This process takes over a run whose owner is gone. False when another process got there first. */
export function takeOrphan(db: Db, id: string, deadPid: number | null): boolean {
  const r = db
    .prepare("update runs set pid = ?, stop_requested = 0 where id = ? and status = 'running' and pid is ?")
    .run(process.pid, id, deadPid);
  return r.changes === 1;
}

export const workingRuns = (db: Db) =>
  db.prepare("select * from runs where status = 'running' order by started_at").all() as unknown as (Run & {
    pid: number | null;
  })[];

/** The lowest free slot, claimed for this run, or nothing when all are busy. */
export function claimSlot(db: Db, runId: string, max: number): number | undefined {
  db.exec("begin immediate");
  try {
    const taken = new Set(
      (db.prepare("select slot from slots").all() as { slot: number }[]).map((r) => r.slot),
    );
    let slot: number | undefined;
    for (let n = 1; n <= max && slot === undefined; n++) if (!taken.has(n)) slot = n;
    if (slot !== undefined) {
      db.prepare("insert into slots (slot, run_id) values (?, ?)").run(slot, runId);
      db.prepare("update runs set slot = ? where id = ?").run(slot, runId);
    }
    db.exec("commit");
    return slot;
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}

export function releaseSlot(db: Db, runId: string): void {
  db.prepare("delete from slots where run_id = ?").run(runId);
}

export function requestStop(db: Db, id: string): void {
  db.prepare("update runs set stop_requested = 1 where id = ?").run(id);
}
export const stopRequested = (db: Db, id: string) =>
  (
    db.prepare("select stop_requested from runs where id = ?").get(id) as
      | { stop_requested: number }
      | undefined
  )?.stop_requested === 1;

/** Runs parked on a wait lane or on an account's limit, whose time has come. */
export const dueRuns = (db: Db) =>
  db
    .prepare(
      "select * from runs where status = 'waiting' and stop_code in ('waiting', 'account_limit') and wake_at <= ? order by wake_at",
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

export function addClaim(db: Db, runId: string, laneRunId: number, text: string, evidence: unknown): void {
  db.prepare("insert into claims (run_id, lane_run_id, text, evidence) values (?, ?, ?, ?)").run(
    runId,
    laneRunId,
    text,
    JSON.stringify(evidence),
  );
}

export function setRunRisk(db: Db, id: string, risk: unknown): void {
  db.prepare("update runs set risk = ? where id = ?").run(JSON.stringify(risk), id);
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
  status: "approved" | "rejected" | "sent_back" | "answered" | "closed",
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

export interface Session {
  run_id: string;
  lane_run_id: number;
  lane: string;
  try: number;
  account: string | null;
  agent: string;
  model: string | null;
  session_id: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  tokens: number;
  /** Null when the cost is unknown: the CLI reported none and the model has no price. */
  usd: number | null;
  usd_source: "reported" | "priced" | "unknown";
  transcript_path: string | null;
  transcript_sha256: string | null;
  started_at: string;
  duration_ms: number;
}

export function addSession(db: Db, s: Session): void {
  const columns = Object.keys(s);
  db.prepare(
    `insert into sessions (${columns.join(", ")}) values (${columns.map(() => "?").join(", ")})`,
  ).run(...(Object.values(s) as (string | number | null)[]));
}

/** Every session, oldest first, with its run's task. One run's when `runId` is given. */
export const sessionsOf = (db: Db, runId?: string) =>
  db
    .prepare(
      `select sessions.*, tasks.title from sessions
       join runs on runs.id = sessions.run_id join tasks on tasks.id = runs.task_id
       where ? is null or sessions.run_id = ? order by sessions.id`,
    )
    .all(runId ?? null, runId ?? null) as unknown as (Session & { title: string })[];
