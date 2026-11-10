// The autonomy ladder (ADR 0011). Each lane's checkpoint is a step: in the loop (a person
// approves), near the loop, out of the loop. A lane earns a step up by its record: a number of
// runs in a row that ended done with nothing sent back, rejected or found later. The factory only
// suggests the step. A person takes it. A defect that got through a lane (an escape) moves the
// lane a step back at once, with no question: stepping back is the safe direction.
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nowIso } from "./clock.ts";
import type { Db } from "./db.ts";
import { UserError } from "./errors.ts";
import { parseWorkflow } from "./schema/parse.ts";
import { oneLine } from "./text.ts";
import type { Workspace } from "./workspace.ts";

export type Mode = "in" | "near" | "out";
const UP: Partial<Record<Mode, Mode>> = { in: "near", near: "out" };
const DOWN: Partial<Record<Mode, Mode>> = { out: "near", near: "in" };
export const STANDS: Record<Mode, string> = {
  in: "in the loop",
  near: "near the loop",
  out: "out of the loop",
};
const DEFAULT_RUNS = 10;
// how a run ends when the lane it stood at failed by its own work, not by a stop, a crash or a budget
const ITS_OWN = new Set(["lane_failed", "gate_stop", "out_of_rounds", "no_progress", "rejected"]);

export interface Move {
  /** `seen` is the step a lane stood on when the ladder first met it. `outside` is a step that changed in the file with no move of the ladder's. */
  kind: "promoted" | "demoted" | "escape" | "outside" | "seen";
  from: Mode | null;
  to: Mode | null;
  at: string;
  note: string;
  run: string | null;
}
export interface LadderLane {
  lane: string;
  name: string;
  checkpoint: Mode;
  /** Runs in a row, the newest first, that ended done with this lane's work left as it was. */
  streak: number;
  needed: number;
  /** The step the record has earned, for a person to take. */
  suggestion: Mode | null;
  /** Why this lane never moves up, whatever its record. */
  why: string | null;
  /** The last thing that happened to it on the ladder. */
  last: Move | null;
}

const all = <T>(db: Db, sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args) as T[];

/** Every lane of the workspace's workflow with its record. Only runs of this workflow, since the lane last moved, count. */
export function ladderView(ws: Workspace, db: Db): { lanes: LadderLane[] } {
  const needed = ws.config.ladder?.runs ?? DEFAULT_RUNS;
  const workflow = ws.workflow.name;
  const lanes = ws.workflow.lanes.map((lane): LadderLane => {
    const moves = all<{
      kind: Move["kind"];
      from_mode: Mode | null;
      to_mode: Mode | null;
      at: string;
      note: string;
      run_id: string | null;
    }>(
      db,
      "select kind, from_mode, to_mode, at, note, run_id from ladder where workflow = ? and lane = ? order by id",
      workflow,
      lane.id,
    );
    // The ladder knows the step it last left the lane on. A step that differs was changed in the
    // file by something else (an edit, a save, an import, a merged change): it is recorded as
    // that, and the record starts again from there. What was earned on one step is not carried
    // to a step the ladder did not give.
    const checkpoint = lane.checkpoint as Mode;
    const known = moves.findLast((m) => m.to_mode !== null)?.to_mode;
    if (known !== checkpoint && !db.isTransaction) {
      const kind = known === undefined ? "seen" : "outside";
      const at = nowIso();
      db.prepare(
        "insert into ladder (workflow, lane, kind, from_mode, to_mode, run_id, note, at) values (?, ?, ?, ?, ?, null, '', ?)",
      ).run(workflow, lane.id, kind, known ?? null, checkpoint, at);
      moves.push({ kind, from_mode: known ?? null, to_mode: checkpoint, at, note: "", run_id: null });
    }
    const latest = moves.findLast((m) => m.kind !== "seen");
    const since = latest?.at ?? "";
    // the runs that went through this lane and have ended, the newest first
    const runs = all<{
      id: string;
      status: string;
      stop_code: string | null;
      last: string | null;
      edited: number;
    }>(
      db,
      `select r.id, r.status, r.stop_code,
         (select l.lane || ':' || coalesce(l.outcome, '') from lane_runs l where l.run_id = r.id order by l.id desc limit 1) as last,
         (select count(*) from inbox i where i.run_id = r.id and i.lane = ? and i.status in ('sent_back', 'rejected')) as edited
       from runs r
       where r.workflow = ? and r.ended_at is not null
         and (select min(l.started_at) from lane_runs l where l.run_id = r.id and l.lane = ?) > ?
       order by r.ended_at desc, r.rowid desc`,
      lane.id,
      workflow,
      lane.id,
      since, // only a visit that began after the lane last moved: a run in flight then went through it on the old step
    );
    let streak = 0;
    for (const run of runs) {
      // The row ends where the lane's work was not left as it was: a person sent it back or
      // rejected it, or the run ended at this lane because the lane's own work failed. A try
      // that failed and was mended inside a run that ended done is the loop doing its job.
      const endedHere =
        run.status !== "done" && run.last === `${lane.id}:fail` && ITS_OWN.has(run.stop_code ?? "");
      if (run.edited > 0 || endedHere) break;
      // a run that ended for another reason (another lane, a person's stop, a crash, a budget) says nothing of this lane
      if (run.status !== "done") continue;
      streak += 1;
    }
    const why = lane.pin ? "it is pinned" : lane.oneWay ? "it does something that cannot be undone" : null;
    const up = UP[checkpoint];
    return {
      lane: lane.id,
      name: lane.name ?? lane.id,
      checkpoint,
      streak,
      needed,
      suggestion: !why && up && streak >= needed ? up : null,
      why,
      last: latest
        ? {
            kind: latest.kind,
            from: latest.from_mode,
            to: latest.to_mode,
            at: latest.at,
            note: latest.note,
            run: latest.run_id,
          }
        : null,
    };
  });
  return { lanes };
}

/** Set a lane's checkpoint in the workflow's file. The file is checked before it is written, and moved into place whole. */
function setCheckpoint(ws: Workspace, laneId: string, to: Mode): void {
  // the file the workspace runs: its name is the workspace's choice, not the workflow's own "name"
  const file = join(ws.factorDir, "workflows", `${ws.config.workflow}.json`);
  const doc = JSON.parse(readFileSync(file, "utf8")) as { lanes?: { id?: string; checkpoint?: string }[] };
  const lane = doc.lanes?.find((l) => l.id === laneId);
  if (!lane)
    throw new UserError(`The workflow's file has no lane "${laneId}" any more.`, "Run the command again.");
  lane.checkpoint = to;
  const problems = parseWorkflow(doc).problems;
  if (problems.length > 0) {
    throw new UserError(
      `The workflow would not be valid with "${laneId}" ${STANDS[to]}: ${problems[0]?.message}`,
      problems[0]?.fix ?? "Fix the workflow first.",
    );
  }
  const beside = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(beside, `${JSON.stringify(doc, null, 2)}\n`, { flag: "wx" });
    renameSync(beside, file);
  } catch (error) {
    rmSync(beside, { force: true });
    throw new Error(`The workflow could not be written: ${(error as Error).message}`);
  }
}

const record = (db: Db, ws: Workspace, lane: string, move: Omit<Move, "at">) =>
  db
    .prepare(
      "insert into ladder (workflow, lane, kind, from_mode, to_mode, run_id, note, at) values (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(ws.workflow.name, lane, move.kind, move.from, move.to, move.run, move.note, nowIso());

/** A person takes the step a lane's record has earned. */
export function acceptStep(ws: Workspace, db: Db, laneId: string): { lane: string; from: Mode; to: Mode } {
  const lane = ladderView(ws, db).lanes.find((l) => l.lane === laneId);
  if (!lane) {
    throw new UserError(
      `The workflow has no lane "${laneId}".`,
      "See the lanes with `softwarefactor ladder`.",
    );
  }
  if (!lane.suggestion) {
    const reason =
      lane.why ??
      (lane.checkpoint === "out"
        ? "it is out of the loop already"
        : `it has ${lane.streak} of ${lane.needed} runs in a row`);
    throw new UserError(
      `The lane "${laneId}" has no step to take: ${reason}.`,
      "A lane moves on its record. See it with `softwarefactor ladder`.",
    );
  }
  const note = `${lane.streak} runs in a row ${lane.checkpoint === "in" ? "approved as they were" : "with nothing found later"}`;
  db.exec("begin immediate"); // the file and the record of the move change together, as seen by any other reader
  try {
    setCheckpoint(ws, laneId, lane.suggestion);
    record(db, ws, laneId, { kind: "promoted", from: lane.checkpoint, to: lane.suggestion, run: null, note });
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
  return { lane: laneId, from: lane.checkpoint, to: lane.suggestion };
}

/** A defect that got through a lane is reported: it is recorded, and the lane steps back if it can. */
export function reportEscape(
  ws: Workspace,
  db: Db,
  runId: string,
  laneId: string,
  note: string,
): { lane: string; from: Mode; to: Mode | null } {
  if (!runId)
    throw new UserError(
      "Name the run the defect got through.",
      'softwarefactor escape <run> --lane <lane> --note "<what got through>"',
    );
  const run = db.prepare("select id, workflow from runs where id = ?").get(runId) as
    | { id: string; workflow: string }
    | undefined;
  if (!run)
    throw new UserError(
      `There is no run "${oneLine(runId, 80)}".`,
      "See the runs with `softwarefactor runs`.",
    );
  if (run.workflow !== ws.workflow.name) {
    throw new UserError(
      `Run ${runId} ran the workflow "${run.workflow}", not the one this workspace runs now.`,
      "Report it while that workflow is the active one.",
    );
  }
  if (!laneId)
    throw new UserError(
      "Name the lane that let it through, with --lane.",
      "It is the lane whose check or review should have caught it.",
    );
  const lane = ws.workflow.lanes.find((l) => l.id === laneId);
  const went = db.prepare("select 1 from lane_runs where run_id = ? and lane = ?").get(runId, laneId);
  if (!lane || !went) {
    throw new UserError(
      `Run ${runId} did not go through a lane "${oneLine(laneId, 80)}".`,
      `See where it went with \`softwarefactor runs ${runId}\`.`,
    );
  }
  const said = oneLine(note, 500);
  if (!said)
    throw new UserError("Say what got through, with --note.", "One sentence a later reader will understand.");
  const ended = db.prepare("select ended_at from runs where id = ?").get(runId) as {
    ended_at: string | null;
  };
  if (!ended.ended_at) {
    throw new UserError(
      `Run ${runId} has not ended yet.`,
      "An escape is something found after a run is over.",
    );
  }
  if (
    db.prepare("select 1 from ladder where kind = 'escape' and run_id = ? and lane = ?").get(runId, laneId)
  ) {
    throw new UserError(
      `An escape through "${laneId}" in run ${runId} is already recorded.`,
      "One defect is one step back. See the lane with `softwarefactor ladder`.",
    );
  }
  ladderView(ws, db); // so that the step the lane stands on is known before it changes
  const from = lane.checkpoint as Mode;
  // a pinned lane is never moved by the ladder, in either direction: the escape is still recorded
  const to = lane.pin ? null : (DOWN[from] ?? null);
  // one piece: if the step back cannot be written, the escape is not recorded either, and can be reported again
  db.exec("begin immediate");
  try {
    record(db, ws, laneId, { kind: "escape", from: null, to: null, run: runId, note: said });
    if (to) {
      setCheckpoint(ws, laneId, to);
      record(db, ws, laneId, { kind: "demoted", from, to, run: runId, note: said });
    }
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    if (error instanceof UserError) throw error;
    throw new UserError(
      `The step back could not be written: ${(error as Error).message}`,
      "Nothing was recorded. Mend that, and report the escape again.",
    );
  }
  return { lane: laneId, from, to };
}

type Say = (line: string) => void;
const day = (at: string) => at.slice(0, 10);
/** What last happened to a lane, in words. */
export const lastWords = (last: Move) =>
  last.kind === "promoted"
    ? `moved ${STANDS[last.to ?? "in"]} on ${day(last.at)}`
    : last.kind === "demoted"
      ? `moved back ${STANDS[last.to ?? "in"]} on ${day(last.at)}: ${last.note}`
      : last.kind === "outside"
        ? `set ${STANDS[last.to ?? "in"]} outside the ladder, seen on ${day(last.at)}: its record starts again`
        : `an escape on ${day(last.at)}: ${last.note}`;

/** `softwarefactor ladder` and `softwarefactor ladder accept <lane>`. */
export function ladderCommand(ws: Workspace, db: Db, args: string[], say: Say): number {
  if (args[0] === "accept") {
    const moved = acceptStep(ws, db, args[1] ?? "");
    say(`${moved.lane} is now ${STANDS[moved.to]} (it was ${STANDS[moved.from]})`);
    return 0;
  }
  const { lanes } = ladderView(ws, db);
  const wide = Math.max(4, ...lanes.map((l) => l.lane.length));
  say(`${"Lane".padEnd(wide)}  ${"Stands".padEnd(15)}  Record`);
  for (const l of lanes) {
    const next = l.suggestion
      ? `: it can move ${STANDS[l.suggestion]}`
      : l.why
        ? ` (it stays here: ${l.why})`
        : "";
    const record = l.checkpoint === "out" && !l.why ? "" : `${l.streak} of ${l.needed} runs in a row${next}`;
    say(
      `${l.lane.padEnd(wide)}  ${STANDS[l.checkpoint].padEnd(15)}  ${record}${l.last ? `  (${lastWords(l.last)})` : ""}`.trimEnd(),
    );
  }
  for (const l of lanes)
    if (l.suggestion)
      say(`To move ${l.lane} ${STANDS[l.suggestion]}: softwarefactor ladder accept ${l.lane}`);
  return 0;
}

/** `softwarefactor escape <run> --lane <lane> --note "<what got through>"`. */
export function escapeCommand(
  ws: Workspace,
  db: Db,
  args: string[],
  flags: { lane?: string; note?: string },
  say: Say,
): number {
  const moved = reportEscape(ws, db, args[0] ?? "", flags.lane ?? "", flags.note ?? "");
  say(`recorded: an escape through ${moved.lane} in run ${args[0]}`);
  say(
    moved.to
      ? `${moved.lane} is back ${STANDS[moved.to]} (it was ${STANDS[moved.from]})`
      : `${moved.lane} stays ${STANDS[moved.from]}: its count starts again`,
  );
  say("A retro is open for it. See it with `softwarefactor retro`.");
  return 0;
}
