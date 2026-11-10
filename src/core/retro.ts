// Retros. What gets through (an escape) and what happens again and again (a repeat) each open a
// retro. The factory lists them, drafts a file from its record, and on a person's word keeps one
// line as a lesson, which every later lane is given with the project's memory. The factory writes
// no lesson by itself and changes no gate: both are files of the repository, changed by a person.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nowIso } from "./clock.ts";
import type { Db } from "./db.ts";
import { UserError } from "./errors.ts";
import { lines, quoted } from "./memory.ts";
import { oneLine, showsAsIs } from "./text.ts";
import type { Workspace } from "./workspace.ts";

const LAST = 20; // the ended runs a repeat is looked for in
const TIMES = 3; // how often makes a repeat

interface Retro {
  id: number;
  key: string;
  kind: "escape" | "repeat";
  lane: string;
  what: string;
  runs: string;
  status: "open" | "drafted" | "kept" | "dropped";
  path: string | null;
  note: string;
  created_at: string;
}
type Say = (line: string) => void;
const all = <T>(db: Db, sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args) as T[];

/** Open a retro for every escape and every repeat that has none yet. One for each, however often it is looked at. */
function sync(ws: Workspace, db: Db): void {
  const workflow = ws.workflow.name;
  const open = (key: string, kind: Retro["kind"], lane: string, what: string, runs: string[]) =>
    db
      .prepare(
        "insert or ignore into retros (key, kind, workflow, lane, what, runs, created_at) values (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(key, kind, workflow, lane, what, JSON.stringify(runs), nowIso());
  for (const e of all<{ id: number; lane: string; run_id: string; note: string }>(
    db,
    "select id, lane, run_id, note from ladder where workflow = ? and kind = 'escape' order by id",
    workflow,
  )) {
    open(`escape:${e.id}`, "escape", e.lane, `lane ${e.lane}, run ${e.run_id}: ${e.note}`, [e.run_id]);
  }
  const recent = all<{ id: string }>(
    db,
    "select id from runs where workflow = ? and ended_at is not null order by ended_at desc, rowid desc limit ?",
    workflow,
    LAST,
  ).map((r) => r.id);
  if (recent.length === 0) return;
  const marks = recent.map(() => "?").join(", ");
  const group = (rows: { lane: string; what: string; run_id: string }[]) => {
    const found = new Map<string, { lane: string; what: string; runs: string[] }>();
    for (const row of rows) {
      const entry = found.get(`${row.lane}\0${row.what}`) ?? { lane: row.lane, what: row.what, runs: [] };
      if (!entry.runs.includes(row.run_id)) entry.runs.push(row.run_id);
      found.set(`${row.lane}\0${row.what}`, entry);
    }
    return [...found.values()].filter((f) => f.runs.length >= TIMES);
  };
  const failed = all<{ lane: string; what: string; run_id: string }>(
    db,
    `select l.lane as lane, g.gate as what, g.run_id as run_id from gate_results g join lane_runs l on l.id = g.lane_run_id
     where g.status = 'fail' and g.run_id in (${marks}) order by g.id`,
    ...recent,
  );
  // A repeat is one retro for its lane and gate (or its lane's decisions), however often it goes
  // on. Once that retro is kept or dropped, it is opened anew only if the same thing happens
  // three more times in runs that ended after it was closed: a lesson that did not help is news.
  const repeat = (key: string, lane: string, runs: string[], words: (n: number) => string) => {
    const before = db
      .prepare("select status, closed_at from retros where key = ? or key like ? order by id desc limit 1")
      .get(key, `${key}#%`) as { status: string; closed_at: string | null } | undefined;
    if (!before) return open(key, "repeat", lane, words(runs.length), runs);
    if (before.status === "open" || before.status === "drafted") return;
    const since = runs.filter((id) => {
      const ended = (db.prepare("select ended_at from runs where id = ?").get(id) as { ended_at: string })
        .ended_at;
      return ended > (before.closed_at ?? "");
    });
    if (since.length >= TIMES) open(`${key}#${since.at(-1)}`, "repeat", lane, words(since.length), since);
  };
  for (const f of group(failed)) {
    repeat(`repeat:gate:${workflow}:${f.lane}:${f.what}`, f.lane, f.runs, (n) => {
      return `lane ${f.lane}: the gate ${f.what} failed in ${n} of the last ${LAST} runs (${f.runs.join(", ")})`;
    });
  }
  const edited = all<{ lane: string; what: string; run_id: string }>(
    db,
    `select lane, '' as what, run_id from inbox where status in ('sent_back', 'rejected') and run_id in (${marks}) order by id`,
    ...recent,
  );
  for (const f of group(edited)) {
    repeat(`repeat:decision:${workflow}:${f.lane}`, f.lane, f.runs, (n) => {
      return `lane ${f.lane}: its work was sent back or rejected in ${n} of the last ${LAST} runs (${f.runs.join(", ")})`;
    });
  }
}

function retroOf(db: Db, id: string): Retro {
  const retro = /^\d+$/.test(id)
    ? (db.prepare("select * from retros where id = ?").get(Number(id)) as Retro | undefined)
    : undefined;
  if (!retro)
    throw new UserError(`There is no retro "${oneLine(id, 40)}".`, "See them with `softwarefactor retro`.");
  return retro;
}
const stillOpen = (retro: Retro, to: string) => {
  if (retro.status === "kept" || retro.status === "dropped") {
    throw new UserError(`Retro ${retro.id} was already ${retro.status}.`, `It cannot be ${to} now.`);
  }
};

/** What the record knows about a retro, as a file for a person to finish. What people and agents wrote is quoted. */
function draftOf(db: Db, retro: Retro): string {
  const runs = JSON.parse(retro.runs) as string[];
  const marks = runs.map(() => "?").join(", ");
  const said =
    retro.kind === "escape"
      ? all<{ note: string }>(
          db,
          "select note from ladder where kind = 'escape' and id = ?",
          Number(retro.key.split(":")[1]),
        ).map((r) => r.note)
      : all<{ note: string | null }>(
          db,
          `select answer as note from inbox where lane = ? and status in ('sent_back', 'rejected') and run_id in (${marks}) order by id`,
          retro.lane,
          ...runs,
        ).flatMap((r) => (r.note ? [r.note] : []));
  const gates = all<{
    run_id: string;
    gate: string;
    status: string;
    exit_code: number | null;
    output_path: string;
  }>(
    db,
    `select g.run_id, g.gate, g.status, g.exit_code, g.output_path from gate_results g join lane_runs l on l.id = g.lane_run_id
     where l.lane = ? and g.run_id in (${marks}) order by g.id`,
    retro.lane,
    ...runs,
  );
  const happened =
    retro.kind === "escape"
      ? `A defect got through lane \`${retro.lane}\` in run ${runs[0]} and was reported:`
      : `${retro.what.replace(/^lane \S+: /, `At lane \`${retro.lane}\`, `)}.${said.length > 0 ? " What was said when the work was sent back:" : ""}`;
  return [
    `# Retro ${retro.id}: ${retro.kind === "escape" ? "an escape" : "a repeat"} at lane ${retro.lane}`,
    `Written by the factory on ${nowIso().slice(0, 10)} from its record. Lines that begin with ">" are quoted: a person or an agent wrote them, the factory did not.`,
    "## What happened",
    happened,
    ...said.map((note) => quoted(lines(note))),
    "## What the lane's gates said",
    gates.length === 0
      ? "The lane had no gate in these runs."
      : gates
          .map(
            (g) =>
              `- run ${g.run_id}: gate ${g.gate}: ${g.status}${g.exit_code === null ? "" : ` (exit ${g.exit_code})`}, output in ${g.output_path}`,
          )
          .join("\n"),
    "## Why it got through",
    "(for you to write)",
    "## The lesson, in one line",
    `(for you to write: what every later lane should know. Then keep it: softwarefactor retro keep ${retro.id} --lesson "<the line>")`,
    "## The check that would catch it",
    "(for you to write. A gate is a command that fails when this happens again. A place to start:)",
    '```json\n{ "<gate id>": { "uses": "core/command@1", "with": { "run": "<a command that exits 1 on this>" }, "onFail": "fail" } }\n```',
    `Add it under "gates" in the workflow and name it in the "gates" of lane \`${retro.lane}\`. That is a change to a file of the repository, reviewed like any other.`,
  ].join("\n\n");
}

/** `softwarefactor retro`, `retro draft <id>`, `retro keep <id> --lesson "..."`, `retro drop <id> --note "..."`. */
export function retroCommand(
  ws: Workspace,
  db: Db,
  args: string[],
  flags: { lesson?: string; note?: string },
  say: Say,
): number {
  sync(ws, db);
  const [verb, id = ""] = args;
  if (verb === "draft") {
    const retro = retroOf(db, id);
    stillOpen(retro, "drafted");
    if (retro.status === "drafted") {
      say(`already drafted: ${retro.path}`);
      return 0;
    }
    const rel = `.factor/retros/${nowIso().slice(0, 10)}-${retro.kind}-${retro.lane}-${retro.id}.md`;
    mkdirSync(join(ws.factorDir, "retros"), { recursive: true });
    try {
      writeFileSync(join(ws.root, rel), `${draftOf(db, retro)}\n`, { flag: "wx" }); // never over a file a person may have begun
    } catch {
      // the file is there already: it is the draft
    }
    db.prepare("update retros set status = 'drafted', path = ? where id = ?").run(rel, retro.id);
    say(`drafted: ${rel}`);
    say("Write why it got through, the lesson and the check. Then keep the lesson, or drop the retro.");
    return 0;
  }
  if (verb === "keep") {
    const retro = retroOf(db, id);
    stillOpen(retro, "kept");
    const lesson = (flags.lesson ?? "").trim();
    // one plain line: it goes into every later prompt under the project's own heading
    if (!lesson || lines(lesson).length > 1 || !showsAsIs(lesson) || lesson.length > 300) {
      throw new UserError(
        "A lesson is one line of plain text, at most 300 characters.",
        `softwarefactor retro keep ${retro.id} --lesson "<the line>"`,
      );
    }
    const dir = join(ws.factorDir, "memory", "lessons");
    mkdirSync(dir, { recursive: true });
    const slug =
      lesson
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "lesson";
    const name = existsSync(join(dir, `${slug}.md`)) ? `${slug}-${retro.id}.md` : `${slug}.md`;
    const runs = (JSON.parse(retro.runs) as string[]).join(", ");
    // where it came from, in the factory's own words only: nothing an agent or a task wrote is carried into a lesson
    const origin =
      retro.kind === "escape"
        ? `From retro ${retro.id}: a defect that got through lane ${retro.lane} in run ${runs}.`
        : `From retro ${retro.id}: something that happened again and again at lane ${retro.lane} (runs ${runs}).`;
    writeFileSync(
      join(dir, name),
      `# ${lesson}\n\n${origin} Kept by a person on ${nowIso().slice(0, 10)}.\n`,
      { flag: "wx" },
    );
    const rel = `.factor/memory/lessons/${name}`;
    db.prepare("update retros set status = 'kept', path = ?, closed_at = ? where id = ?").run(
      rel,
      nowIso(),
      retro.id,
    );
    say(`kept: ${rel}`);
    say("Commit it. Every later lane is given it with what the project remembers.");
    return 0;
  }
  if (verb === "drop") {
    const retro = retroOf(db, id);
    stillOpen(retro, "dropped");
    const note = oneLine(flags.note ?? "", 300);
    if (!note)
      throw new UserError(
        "Say why it is not worth a lesson, with --note.",
        `softwarefactor retro drop ${retro.id} --note "<why>"`,
      );
    db.prepare("update retros set status = 'dropped', note = ?, closed_at = ? where id = ?").run(
      note,
      nowIso(),
      retro.id,
    );
    say(`dropped: retro ${retro.id}`);
    return 0;
  }
  if (verb !== undefined)
    throw new UserError(
      `"retro ${oneLine(verb, 40)}" is not a command.`,
      'softwarefactor retro [draft <id> | keep <id> --lesson "..." | drop <id> --note "..."]',
    );
  const retros = all<Retro>(db, "select * from retros where workflow = ? order by id", ws.workflow.name);
  if (retros.length === 0) {
    say(
      "Nothing calls for a retro: no escape has been reported, and nothing has happened three times in the last twenty runs.",
    );
    return 0;
  }
  for (const r of retros) {
    const more = r.status === "dropped" ? `  (dropped: ${r.note})` : r.path ? `  ${r.path}` : "";
    say(`${r.id}  ${r.status.padEnd(7)}  ${r.kind.padEnd(6)}  ${r.what}${more}`);
  }
  const first = retros.find((r) => r.status === "open");
  if (first) say(`To look into one: softwarefactor retro draft ${first.id}`);
  return 0;
}
