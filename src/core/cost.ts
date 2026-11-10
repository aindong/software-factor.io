// `softwarefactor cost`: where the tokens and the money went, from the session records. By task,
// lane, account and model, with the cache hit rate, what a landed task cost and the runs that
// cost most and did not land. `--check` proves the report: its lanes against the rows, summed
// again by the database, and each row against what the CLI itself printed, in the transcript the
// factory kept.
import { createHash } from "node:crypto";
import { basename, join, relative } from "node:path";
import { claudeUsage } from "./agents/claude.ts";
import { codexUsage } from "./agents/codex.ts";
import type { Db } from "./db.ts";
import { readTail } from "./safe-read.ts";
import type { Session } from "./store.ts";
import { money, oneLine } from "./text.ts";
import { type CostLine, type CostsView, costLine, costsView, millionth } from "./views.ts";
import type { Workspace } from "./workspace.ts";

type Say = (line: string) => void;
type Row = Session & {
  run_status: string | null;
  stop_code: string | null;
  title: string | null;
  task_status: string | null;
};
const KINDS = [
  ["input", "input_tokens", "input"],
  ["output", "output_tokens", "output"],
  ["cacheRead", "cache_read_tokens", "cache read"],
  ["cacheWrite", "cache_write_tokens", "cache write"],
] as const;
type Kinds = Record<(typeof KINDS)[number][0], number>;

export interface CostReport extends CostsView {
  byModel: (CostLine & { model: string | null; cacheRate: number | null })[];
  /** Per lane, the four kinds of tokens as its session rows add up. */
  usage: (Kinds & { lane: string; tokens: number })[];
  /** Of everything that went in, the whole percent that was read from a cache. Null when nothing could be. */
  cacheRate: number | null;
  landed: {
    /** Tasks that ended done, of the tasks that ended at all. */
    tasks: number;
    ended: number;
    /** Every run of the landed tasks, the ones that stopped included. */
    spent: CostLine;
    perTask: number | null;
    notLanded: CostLine;
    /** Tasks that are still open, and sessions whose task is no longer in the record. */
    other: CostLine;
  };
  /** `usd` is the cost that is known, and `unknown` how many of the run's sessions it leaves out. */
  failedRuns: {
    run: string;
    task: string;
    why: string;
    tokens: number;
    usd: number | null;
    unknown: number;
  }[];
}

const sum = (rows: Row[], column: (typeof KINDS)[number][1] | "tokens") =>
  rows.reduce((total, s) => total + s[column], 0);

/** Cache read over everything that went in, rounded down. The scripted agent names no kinds and has no cache. */
function cacheRate(rows: Row[]): number | null {
  const real = rows.filter((s) => s.agent !== "fake");
  const read = sum(real, "cache_read_tokens");
  const all = sum(real, "input_tokens") + read + sum(real, "cache_write_tokens");
  // whole numbers until the last step: 0.29 * 100 is a little under 29
  return all === 0 ? null : Math.floor((read * 100) / all);
}

function groups<T>(rows: T[], key: (row: T) => string): T[][] {
  const by = new Map<string, T[]>();
  for (const row of rows) by.set(key(row), [...(by.get(key(row)) ?? []), row]);
  return [...by.values()];
}

const MOST_FAILED = 5;

export function costReport(db: Db): CostReport {
  // every session counts, also one whose run or task is no longer in the record
  const rows = db
    .prepare(
      `select s.*, r.status as run_status, r.stop_code, t.title, t.status as task_status from sessions s
       left join runs r on r.id = s.run_id left join tasks t on t.id = r.task_id order by s.id`,
    )
    .all() as unknown as Row[];
  const tasks = db.prepare("select status, count(*) as n from tasks group by status").all() as {
    status: string;
    n: number;
  }[];
  const count = (...statuses: string[]) =>
    tasks.filter((t) => statuses.includes(t.status)).reduce((total, t) => total + t.n, 0);
  const landedTasks = count("done");
  const of = (...statuses: string[]) => rows.filter((s) => statuses.includes(s.task_status ?? ""));
  const spent = costLine(of("done"));
  const failed = groups(
    rows.filter((s) => s.run_status === "stopped" || s.run_status === "dropped"),
    (s) => s.run_id,
  ).map((list) => ({
    run: list[0]?.run_id ?? "",
    task: list[0]?.title ?? "",
    why: list[0]?.stop_code ?? list[0]?.run_status ?? "",
    tokens: sum(list, "tokens"),
    // a start that was cut off prints no cost: the run is still ranked by the cost that is known
    usd: costLine(list).usd,
    unknown: costLine(list).unknown,
  }));
  // by known cost, and after those the runs of unknown cost by what they used
  failed.sort(
    (x, y) =>
      Number(x.usd === null) - Number(y.usd === null) ||
      (y.usd ?? 0) - (x.usd ?? 0) ||
      y.tokens - x.tokens ||
      x.run.localeCompare(y.run),
  );
  return {
    ...costsView(db),
    byModel: groups(rows, (s) => s.model ?? "").map((list) => ({
      model: list[0]?.model || null,
      ...costLine(list),
      cacheRate: cacheRate(list),
    })),
    usage: groups(rows, (s) => s.lane).map((list) => ({
      lane: list[0]?.lane ?? "",
      input: sum(list, "input_tokens"),
      output: sum(list, "output_tokens"),
      cacheRead: sum(list, "cache_read_tokens"),
      cacheWrite: sum(list, "cache_write_tokens"),
      tokens: sum(list, "tokens"),
    })),
    cacheRate: cacheRate(rows),
    landed: {
      tasks: landedTasks,
      ended: count("done", "stopped", "dropped"),
      spent,
      // no landed task, or none of their cost known: there is nothing to divide
      perTask:
        landedTasks === 0 || (spent.sessions > 0 && spent.usd === null)
          ? null
          : millionth((spent.usd ?? 0) / landedTasks),
      notLanded: costLine(of("stopped", "dropped")),
      other: costLine(rows.filter((s) => !["done", "stopped", "dropped"].includes(s.task_status ?? ""))),
    },
    // a run that used nothing is not an expensive one
    failedRuns: failed.filter((r) => r.tokens > 0 || (r.usd ?? 0) > 0).slice(0, MOST_FAILED),
  };
}

const sessions = (n: number) => `${n} session${n === 1 ? "" : "s"}`;
const notCounted = (line: CostLine) =>
  line.unknown > 0 ? `  (${line.unknown} of unknown cost not counted)` : "";
const amount = (line: CostLine) => (line.usd === null ? "unknown" : `${money(line.usd)}${notCounted(line)}`);
const used = (line: CostLine) =>
  `${String(line.sessions).padStart(4)} session${line.sessions === 1 ? " " : "s"} ${String(line.tokens).padStart(12)} tokens  ${amount(line)}`;
const name = (text: string) => text.slice(0, 28).padEnd(28);
const num = (n: number) => String(n).padStart(13);

/** `cost`: the report, printed. */
export function costCommand(db: Db, say: Say): number {
  const costs = costReport(db);
  if (costs.total.sessions === 0) {
    say("No sessions yet. A session is recorded each time an agent starts on a lane.");
    return 0;
  }
  say("By task");
  for (const t of costs.byTask) say(`  ${name(t.task)} ${used(t)}`);
  say(
    `By lane${" ".repeat(23)}${["sessions", "input", "output", "cache read", "cache write", "tokens"].map((h) => h.padStart(13)).join("")}  cost`,
  );
  for (const l of costs.byLane) {
    const kinds = costs.usage.find((u) => u.lane === l.lane);
    const counts = [l.sessions, kinds?.input, kinds?.output, kinds?.cacheRead, kinds?.cacheWrite, l.tokens];
    say(`  ${name(l.lane)}${counts.map((n) => num(n ?? 0)).join("")}  ${amount(l)}`);
  }
  say("By account");
  for (const a of costs.byAccount) say(`  ${name(a.account ?? "(the scripted agent)")} ${used(a)}`);
  say("By model");
  for (const m of costs.byModel) {
    say(
      `  ${name(m.model ?? "(no model named)")} ${used(m)}${m.cacheRate === null ? "" : `  cache ${m.cacheRate}%`}`,
    );
  }
  say(`Total${" ".repeat(25)} ${used({ ...costs.total, unknown: 0 })}`);
  const { unknown } = costs.total;
  if (unknown > 0) {
    say(`${sessions(unknown)} of unknown cost ${unknown === 1 ? "is" : "are"} not in the totals`);
  }
  say(
    `Cache hit rate${" ".repeat(16)} ${costs.cacheRate === null ? "none: no session could read from a cache" : `${costs.cacheRate}% of what went in was read from a cache`}`,
  );
  const { landed } = costs;
  say("Landed");
  if (landed.tasks === 0) say("  No task has landed yet.");
  else {
    say(`  ${landed.tasks} of ${landed.ended} ended task${landed.ended === 1 ? "" : "s"} landed`);
    const unknownToo =
      landed.spent.unknown > 0 ? `  (${sessions(landed.spent.unknown)} of unknown cost not counted)` : "";
    say(
      `  cost per landed task${" ".repeat(8)} ${landed.perTask === null ? "unknown" : money(landed.perTask)}  (every run of those tasks)${unknownToo}`,
    );
  }
  if (landed.notLanded.sessions > 0) say(`  spent on tasks that did not land  ${amount(landed.notLanded)}`);
  if (landed.other.sessions > 0)
    say(`  spent on tasks still open, or no longer in the record  ${amount(landed.other)}`);
  if (costs.failedRuns.length > 0) {
    say("Most expensive runs that did not land");
    for (const r of costs.failedRuns) {
      say(
        `  ${r.run}  ${r.task.slice(0, 28)}  ${r.why}  ${r.tokens} tokens  ${r.usd === null ? "unknown" : `${money(r.usd)}${notCounted({ ...costs.total, unknown: r.unknown })}`}`,
      );
    }
  }
  return 0;
}

const MOST_BYTES = 1_000_000_000;

/** The objects a transcript holds, one to a line, and whether the factory cut its start off. */
function eventsOf(data: Buffer): { events: Record<string, unknown>[]; cut: boolean } {
  const events: Record<string, unknown>[] = [];
  for (const line of data.toString("utf8").split("\n")) {
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === "object" && value !== null) events.push(value as Record<string, unknown>);
    } catch {
      // not an event
    }
  }
  return { events, cut: events[0]?.type === "factor.cut" };
}

/** `cost --check`: 0 when the report, the session rows and the kept transcripts say the same, to the token. */
export function costCheck(ws: Pick<Workspace, "root" | "runsDir">, db: Db, say: Say): number {
  // one view of the record for every read: a factory that works meanwhile adds rows between two reads
  db.exec("begin");
  try {
    return check(ws, db, say);
  } finally {
    db.exec("commit");
  }
}

function check(ws: Pick<Workspace, "root" | "runsDir">, db: Db, say: Say): number {
  const report = costReport(db);
  if (report.total.sessions === 0) {
    say("No sessions yet. There is nothing to check.");
    return 0;
  }
  const problems: string[] = [];
  // the report's lanes against the rows, added up a second time by the database
  const added = db
    .prepare(
      `select lane, sum(input_tokens) as input, sum(output_tokens) as output, sum(cache_read_tokens) as cacheRead,
       sum(cache_write_tokens) as cacheWrite, sum(tokens) as tokens from sessions group by lane`,
    )
    .all() as unknown as CostReport["usage"];
  for (const lane of new Set([...added, ...report.usage].map((u) => u.lane))) {
    const rows = added.find((u) => u.lane === lane);
    const said = report.usage.find((u) => u.lane === lane);
    for (const kind of ["input", "output", "cacheRead", "cacheWrite", "tokens"] as const) {
      if (rows?.[kind] !== said?.[kind])
        problems.push(
          `lane ${lane}: the report says ${said?.[kind] ?? "nothing"} for ${kind} and its session rows add up to ${rows?.[kind] ?? "nothing"}`,
        );
    }
  }
  let reread = 0;
  let none = 0;
  let notRead = 0;
  for (const s of db.prepare("select * from sessions order by id").all() as unknown as Session[]) {
    const at = `run ${s.run_id}, lane ${s.lane}, try ${s.try}`;
    const kinds = s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_write_tokens;
    if (s.tokens !== kinds)
      problems.push(`${at}: its total is ${s.tokens} and its four kinds add up to ${kinds}`);
    // only the scripted agent, and a start that used nothing, have nothing to prove
    const reads = s.agent === "claude" || s.agent === "codex";
    if (kinds > 0 && s.agent !== "fake" && (!reads || s.transcript_path === null)) {
      problems.push(
        reads
          ? `${at}: its row holds ${kinds} tokens and names no transcript: the row cannot be proved`
          : `${at}: its row holds ${kinds} tokens, and the output of the agent "${oneLine(s.agent, 40)}" names none: the row cannot be proved`,
      );
      continue;
    }
    if (s.transcript_path === null) {
      none += 1;
      continue;
    }
    // the file is read where the factory keeps a run's transcripts, and nowhere a row may point
    const file = join(ws.runsDir, s.run_id, "sessions", basename(s.transcript_path));
    if (relative(ws.root, file) !== s.transcript_path) {
      problems.push(`${at}: its row names a transcript outside its run's folder, which is not read`);
      continue;
    }
    const kept = readTail(file, MOST_BYTES);
    if (!kept || kept.cut) {
      // a file that is gone must not hide a row that was changed
      problems.push(`${at}: ${s.transcript_path} is gone, or is not a plain file: the row cannot be proved`);
      continue;
    }
    if (createHash("sha256").update(kept.data).digest("hex") !== s.transcript_sha256) {
      problems.push(`${at}: ${s.transcript_path} is not the file that was kept: its SHA-256 differs`);
      continue;
    }
    const { events, cut } = eventsOf(kept.data);
    // a Claude transcript ends with its result. A Codex one names its tokens turn by turn: cut, it has lost some
    const printed =
      s.agent === "claude"
        ? (claudeUsage(events) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
        : s.agent === "codex" && !cut
          ? codexUsage(events)
          : undefined;
    if (!printed) {
      notRead += 1;
      continue;
    }
    reread += 1;
    for (const [kind, column, words] of KINDS) {
      if (s[column] !== printed[kind])
        problems.push(
          `${at}: the row holds ${s[column]} ${words} tokens and the CLI printed ${printed[kind]} in ${s.transcript_path}`,
        );
    }
  }
  for (const problem of problems) say(problem);
  const lanes = report.usage.length;
  const checked = `${sessions(report.total.sessions)} on ${lanes} lane${lanes === 1 ? "" : "s"}: ${reread} transcript${reread === 1 ? "" : "s"} re-read, ${none} with no transcript${notRead > 0 ? `, ${notRead} kept but not re-read (cut, or of an agent whose output names no tokens)` : ""}.`;
  if (problems.length > 0) {
    say(`Checked ${checked} ${problems.length} thing${problems.length === 1 ? " does" : "s do"} not match.`);
    return 1;
  }
  say(`Checked ${checked} The report matches the session records, to the token.`);
  return 0;
}
