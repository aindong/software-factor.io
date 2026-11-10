// The runs as the interface shows them: the list, and one run with everything behind it. Read
// from the record and from the run's folder, changing nothing. What the record holds is not
// trusted to be whole: a state that does not parse or a workflow that is gone still gives a row.
import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { Db } from "../db.ts";
import { isAlive } from "../engine/recover.ts";
import type { RunState } from "../engine/state.ts";
import { hostEnv } from "../exec.ts";
import { drawable } from "../floor/layout.ts";
import { readTail } from "../safe-read.ts";
import type { GateRecord, InboxItem, Outcome, Run, Session } from "../store.ts";
import { factorHome, workspaceId } from "../workspace.ts";
import { activityOf, type Now, sentenceOf } from "./sentence.ts";
import { kindOf } from "./track.ts";

const MOST = 50;
const TAIL = 64_000;
const FAR_TAIL = 4_000_000;
const MAX_FILE = 50_000_000;
const MAX_DIFF = 1_000_000;
const NAME = /^[a-z][a-z0-9-]*$/;
const MAX_GIT = 8_000_000;
const GIT_MS = 10_000;
// a full id only: a shorter word could be the name of a branch an agent made
const COMMIT = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

export interface RunRow {
  id: string;
  /** The task's number in this workspace: what its train carries on the map. */
  taskId: number;
  task: string;
  workflow: string;
  status: Run["status"];
  stopCode: string | null;
  reason: string | null;
  startedAt: string;
  endedAt: string | null;
  visits: { lane: string; outcome: Outcome | null }[];
  /** The lane the run is at: working in it, waiting at it, or stopped in it. Nothing when it is done. */
  at: string | null;
  sentence: string;
  tokens: number;
  usd: number;
  /** A session of the run has no known cost: `usd` is then less than the whole. */
  usdUnknown: boolean;
}
interface Evidence {
  ref: string;
  ok: boolean;
  path?: string;
}
export interface RunDetail extends RunRow {
  branch: string;
  lanes: {
    id: number;
    lane: string;
    outcome: Outcome | null;
    note: string | null;
    tokens: number;
    usd: number;
    durationMs: number;
    startedAt: string;
    endedAt: string | null;
    gates: {
      gate: string;
      status: string;
      command: string | null;
      exitCode: number | null;
      durationMs: number;
      attempt: number;
      output: string;
    }[];
    claims: { text: string; evidence: Evidence[] }[];
    sessions: {
      agent: string;
      account: string | null;
      model: string | null;
      tokens: number;
      usd: number | null;
      usdSource: string;
      transcript: string | null;
    }[];
    handoff: string | null;
    /** What a command lane printed, when it is one. */
    output: string | null;
  }[];
  inbox: { id: number; lane: string; kind: string; body: string }[];
  files: { path: string; name: string; size: number; visit: number }[];
}

type Row = Run & { title: string | null; started_at: string; ended_at: string | null };
type LaneRow = {
  id: number;
  seq: number;
  lane: string;
  outcome: Outcome | null;
  note: string | null;
  handoff_path: string | null;
  started_at: string;
  ended_at: string | null;
  tokens: number;
  usd: number;
  duration_ms: number;
};
type LaneDef = { id: string; name?: string; uses?: string; gates?: string[]; panel?: unknown };

const all = <T>(db: Db, sql: string, ...args: (string | number)[]) =>
  db.prepare(sql).all(...args) as unknown as T[];
const parsed = <T>(text: string | null, otherwise: T): T => {
  try {
    const value: unknown = JSON.parse(text ?? "");
    return typeof value === "object" && value !== null ? (value as T) : otherwise;
  } catch {
    return otherwise;
  }
};

/** Reads each workflow's lanes once, as far as they can be read. */
function laneReader(root: string): (workflow: string) => LaneDef[] {
  const known = new Map<string, LaneDef[]>();
  return (workflow) => {
    let lanes = known.get(workflow);
    if (!lanes) {
      lanes = [];
      try {
        const file = join(root, ".factor", "workflows", `${workflow}.json`);
        if (NAME.test(workflow))
          lanes = (drawable(JSON.parse(readFileSync(file, "utf8")))?.lanes ?? []) as LaneDef[];
      } catch {
        // the workflow is gone or broken: lanes go by their ids
      }
      known.set(workflow, lanes);
    }
    return lanes;
  };
}

/**
 * What the open lane of a moving run is busy with, from what happened since the lane was entered:
 * the lane before left events too, and they say nothing about this one.
 */
function busyWith(
  db: Db,
  root: string,
  runId: string,
  open: LaneRow | undefined,
  def: LaneDef | undefined,
): Partial<Now> {
  if (def?.uses?.startsWith("core/command")) return { phase: "command" };
  if (def?.uses?.startsWith("core/wait")) return { phase: "wait" };
  if (!open) return {};
  const events = all<{ kind: string; at: string; data: string }>(
    db,
    "select kind, at, data from events where run_id = ? and kind in ('lane.agent', 'lane.session') and at >= ? order by id",
    runId,
    open.started_at,
  );
  const ended = events.filter((e) => e.kind === "lane.session");
  const atWork = events.length - ended.length * 2; // each agent leaves one event when it starts and one when it ends
  const panel = Array.isArray((def?.panel as { members?: unknown } | undefined)?.members);
  if (panel && atWork > 0) return { phase: "panel", members: atWork };
  if (panel && events.length === 0) return {};
  const last = events.at(-1);
  if (last?.kind === "lane.session") {
    // the agent has ended and the gates check its work: those of this check, not of one before a repair
    const done = db
      .prepare("select count(*) as n from gate_results where lane_run_id = ? and started_at >= ?")
      .get(open.id, last.at) as { n: number };
    const gates = { phase: "gates" as const, gatesDone: done.n, gatesTotal: def?.gates?.length ?? 0 };
    return panel ? { ...gates, members: 0 } : gates;
  }
  const handoff = parsed<{ handoffPath?: unknown }>(last?.data ?? null, {}).handoffPath;
  // The CLI's raw output is in the host's folder beside the lane's. The record says where the
  // lane's folder is, but only a folder of this run's own is read, and never through a link.
  const out = join(factorHome(), "work", workspaceId(root), `${runId}.out`);
  if (typeof handoff !== "string" || dirname(dirname(resolve(handoff))) !== out) return { phase: "agent" };
  const stream = join(`${dirname(resolve(handoff))}.host`, "stream.jsonl");
  const read = (bytes: number) => readTail(stream, bytes)?.data.toString("utf8");
  const tail = read(TAIL);
  // the last line is often one long result of a tool: look further back for what was done
  const far = tail !== undefined && activityOf(tail) === undefined;
  return { phase: "agent", tail: far ? read(FAR_TAIL) : tail };
}

function rowOf(db: Db, root: string, run: Row, lanesOf: (workflow: string) => LaneDef[]): RunRow {
  const visits = all<LaneRow>(db, "select * from lane_runs where run_id = ? order by seq, id", run.id);
  const state = parsed<Partial<RunState>>(run.state, {});
  const open = visits.findLast((v) => v.ended_at === null);
  const at =
    run.status === "running"
      ? (open?.lane ?? state.next ?? null)
      : run.status === "waiting"
        ? (state.parked?.lane ?? state.next ?? null)
        : run.status === "stopped"
          ? (visits.at(-1)?.lane ?? null)
          : null;
  const def = lanesOf(run.workflow).find((l) => l.id === at);
  const now: Now = {
    status: run.status,
    stopCode: run.stop_code,
    reason: run.stop_reason,
    lane: at ? (def?.name ?? at) : undefined,
    parked: state.parked?.kind,
  };
  if (run.status === "running") {
    now.gone = run.pid !== process.pid && !isAlive(run.pid);
    if (!now.gone) Object.assign(now, busyWith(db, root, run.id, open, def));
  }
  const used = db
    .prepare(
      "select coalesce(sum(tokens), 0) as tokens, coalesce(sum(usd), 0) as usd from sessions where run_id = ?",
    )
    .get(run.id) as { tokens: number; usd: number };
  const unknown = db
    .prepare("select count(*) as n from sessions where run_id = ? and usd is null")
    .get(run.id) as { n: number };
  return {
    id: run.id,
    taskId: run.task_id,
    task: run.title ?? "",
    workflow: run.workflow,
    status: run.status,
    stopCode: run.stop_code,
    reason: run.stop_reason,
    startedAt: run.started_at,
    endedAt: run.ended_at,
    visits: visits.map((v) => ({ lane: v.lane, outcome: v.outcome })),
    at,
    sentence: sentenceOf(now),
    // from the sessions, not the lanes: a lane's own sums are written only when it ends
    tokens: used.tokens,
    usd: Math.round(used.usd * 1e6) / 1e6,
    usdUnknown: unknown.n > 0,
  };
}

const RUNS = "select runs.*, tasks.title from runs left join tasks on tasks.id = runs.task_id";

/** Every run that is moving or waiting, and the latest ended ones up to 50 in all, the newest first. */
export function listRuns(db: Db, root: string): RunRow[] {
  const active = all<Row>(db, `${RUNS} where runs.status in ('running', 'waiting')`);
  const ended = all<Row>(
    db,
    `${RUNS} where runs.status not in ('running', 'waiting') order by runs.started_at desc, runs.rowid desc limit ?`,
    Math.max(0, MOST - active.length),
  );
  const lanesOf = laneReader(root);
  return [...active, ...ended]
    .sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0))
    .map((run) => rowOf(db, root, run, lanesOf));
}

const runFolder = (root: string, id: string) => join(root, ".factor", "runs", id);

/** The run's own evidence files: plain files with one name, in a folder that is no link. */
function evidenceFiles(root: string, id: string): { path: string; file: string; size: number }[] {
  const dir = join(runFolder(root, id), "evidence");
  try {
    if (realpathSync(dir) !== join(realpathSync(root), ".factor", "runs", id, "evidence")) return [];
    return readdirSync(dir)
      .sort()
      .flatMap((file) => {
        const stat = lstatSync(join(dir, file));
        return stat.isFile() && stat.nlink === 1
          ? [{ path: relative(root, join(dir, file)), file, size: stat.size }]
          : [];
      });
  } catch {
    return []; // no evidence yet
  }
}

export function runDetail(db: Db, root: string, id: string): RunDetail | undefined {
  const run = db.prepare(`${RUNS} where runs.id = ?`).get(id) as Row | undefined;
  if (!run) return undefined;
  const named = new Map<string, { name: string; visit: number }>();
  const files = evidenceFiles(root, id);
  const lanes = all<LaneRow>(db, "select * from lane_runs where run_id = ? order by seq, id", id).map((l) => {
    const gates = all<GateRecord>(db, "select * from gate_results where lane_run_id = ? order by id", l.id);
    const claims = all<{ text: string; evidence: string }>(
      db,
      "select text, evidence from claims where lane_run_id = ? order by id",
      l.id,
    ).map((c) => ({ text: c.text, evidence: parsed<Evidence[]>(c.evidence, []) }));
    for (const g of gates) named.set(g.output_path, { name: basename(g.output_path), visit: l.id });
    // a command lane's own output is kept under the lane's tag
    const output = files.find((f) => f.file === `${String(l.seq).padStart(2, "0")}-${l.lane}.log`)?.path;
    if (output) named.set(output, { name: basename(output), visit: l.id });
    for (const e of claims.flatMap((c) => c.evidence)) {
      if (e.path && e.ref?.startsWith("attached:")) named.set(e.path, { name: e.ref.slice(9), visit: l.id });
    }
    return {
      id: l.id,
      lane: l.lane,
      outcome: l.outcome,
      note: l.note,
      tokens: l.tokens,
      usd: l.usd,
      durationMs: l.duration_ms,
      startedAt: l.started_at,
      endedAt: l.ended_at,
      gates: gates.map((g) => ({
        gate: g.gate,
        status: g.status,
        command: g.command,
        exitCode: g.exit_code,
        durationMs: g.duration_ms,
        attempt: g.attempt,
        output: g.output_path,
      })),
      claims,
      sessions: all<Session>(db, "select * from sessions where lane_run_id = ? order by id", l.id).map(
        (s) => ({
          agent: s.agent,
          account: s.account,
          model: s.model,
          tokens: s.tokens,
          usd: s.usd,
          usdSource: s.usd_source,
          transcript: s.transcript_path,
        }),
      ),
      handoff: l.handoff_path,
      output: output ?? null,
    };
  });
  return {
    ...rowOf(db, root, run, laneReader(root)),
    branch: run.branch,
    lanes,
    inbox: all<InboxItem>(db, "select * from inbox where run_id = ? and status = 'open' order by id", id).map(
      (i) => ({ id: i.id, lane: i.lane, kind: i.kind, body: i.body }),
    ),
    files: files.map((f) => ({
      path: f.path,
      name: named.get(f.path)?.name ?? f.file,
      size: f.size,
      visit: named.get(f.path)?.visit ?? 0,
    })),
  };
}

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  webm: "video/webm",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

/**
 * A file of a run, by its path from the workspace's root, as the record gives it. Only a plain
 * file with one name inside that run's own folder, with no link on the way. An image or a video
 * has its own type. Everything else is plain text or a download: never a page.
 */
export function runFile(
  db: Db,
  root: string,
  id: string,
  path: string,
): { data: Buffer; type: string; download?: string } | "too large" | undefined {
  if (!path || !db.prepare("select 1 from runs where id = ?").get(id)) return undefined;
  const base = runFolder(root, id);
  const file = resolve(root, path);
  if (!file.startsWith(`${base}${sep}`)) return undefined;
  try {
    const within = relative(base, dirname(file));
    if (realpathSync(dirname(file)) !== join(realpathSync(root), ".factor", "runs", id, within))
      return undefined;
  } catch {
    return undefined; // the folder is not there
  }
  const read = readTail(file, MAX_FILE);
  if (!read) return undefined;
  if (read.cut) return "too large"; // its tail alone would pass for the whole
  const kind = kindOf(basename(file));
  const ext = /\.([A-Za-z0-9]+)$/.exec(file)?.[1]?.toLowerCase() ?? "";
  if (kind === "image" || kind === "recording") {
    return { data: read.data, type: TYPES[ext] ?? "application/octet-stream" };
  }
  if (kind === "text") return { data: read.data, type: "text/plain; charset=utf-8" };
  return {
    data: read.data,
    type: "application/octet-stream",
    download: basename(file).replace(/[^A-Za-z0-9._-]/g, "_"),
  };
}

/**
 * What the run changed, from its base commit to its head: every changed file by name, and the
 * diff up to a size. A note says why when there is none. The names come whole also when the diff
 * is cut, so a long file put first cannot hide the others.
 */
export function runDiff(
  db: Db,
  root: string,
  id: string,
): { diff: string; cut: boolean; changed: string[]; note?: string } | undefined {
  const run = db.prepare("select base_commit, head_commit from runs where id = ?").get(id) as
    | { base_commit: string; head_commit: string | null }
    | undefined;
  if (!run) return undefined;
  const none = (note: string) => ({ diff: "", cut: false, changed: [], note });
  if (!run.head_commit) return none("This run has made no commit yet.");
  // only a commit's full id is ever handed to git: never a word that could be an option or a branch
  if (!COMMIT.test(run.base_commit) || !COMMIT.test(run.head_commit)) {
    return none("The record of this run holds no commit to compare.");
  }
  const diff = (...how: string[]) =>
    spawnSync(
      "git",
      [
        ...["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "diff", "--no-color"],
        ...["--no-ext-diff", "--no-textconv", ...how, run.base_commit, run.head_commit ?? "", "--"],
      ],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        env: hostEnv(),
        maxBuffer: MAX_GIT,
        timeout: GIT_MS,
      },
    );
  const names = diff("--name-status");
  if (names.status !== 0) return none("The run's commits are no longer in this repository.");
  const whole = diff();
  // more than git was given room for, or more than its time: what came is shown, and said to be a part
  const text = whole.stdout ?? "";
  return {
    diff: text.slice(0, MAX_DIFF),
    cut: whole.status !== 0 || text.length > MAX_DIFF,
    changed: names.stdout.split("\n").filter(Boolean),
  };
}
