// What the project has learned, kept by the factory and not by any one vendor's CLI (ADR 0007).
// Kept memory is markdown files under .factor/memory/, so a change to it is reviewed like any
// other change. What an agent leaves for later lanes is a note: a row, shown as an agent's words,
// and made permanent only by a person.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nowIso } from "./clock.ts";
import type { Db } from "./db.ts";
import { UserError } from "./errors.ts";
import { oneLine } from "./text.ts";

export interface Entry {
  /** Its path under .factor/memory/, such as "lessons/tests.md". */
  id: string;
  title: string;
  body: string;
}
export interface Note {
  id: number;
  run_id: string;
  lane: string;
  account: string | null;
  title: string;
  body: string;
  status: "proposed" | "kept" | "dropped";
  created_at: string;
}
/** Who is asking: the lane a server was started for. */
export interface Asker {
  run: string;
  lane: string;
  account?: string;
}

const MAX_FILE = 100_000;
const MAX_BODY = 4000;
const MAX_NOTES_PER_LANE = 20;
const PROMPT_BUDGET = 8000; // characters of memory bodies in a prompt, before titles only

/** Every memory file, by path. Links are not followed, and a file that is too large is skipped. */
export function readMemory(factorDir: string): Entry[] {
  const root = join(factorDir, "memory");
  const entries: Entry[] = [];
  const walk = (dir: string, prefix: string, depth: number) => {
    if (depth > 3 || !existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(path, `${prefix}${name}/`, depth + 1);
      else if (stat.isFile() && name.endsWith(".md") && stat.size <= MAX_FILE) {
        const text = readFileSync(path, "utf8");
        const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? name.replace(/\.md$/, "");
        entries.push({ id: `${prefix}${name}`, title, body: text.replace(/^#\s+.+\n?/m, "").trim() });
      }
    }
  };
  walk(root, "", 0);
  return entries;
}

/** A note an agent leaves for later lanes. Throws with the reason when it is refused. */
export function addNote(db: Db, by: Asker, title: string, body: string): number {
  if (body.length > MAX_BODY) throw new Error(`A note's body can be at most ${MAX_BODY} characters.`);
  const { n } = db
    .prepare("select count(*) as n from memory_notes where run_id = ? and lane = ?")
    .get(by.run, by.lane) as { n: number };
  if (n >= MAX_NOTES_PER_LANE) throw new Error(`A lane can leave at most ${MAX_NOTES_PER_LANE} notes.`);
  const r = db
    .prepare(
      "insert into memory_notes (run_id, lane, account, title, body, status, created_at) values (?, ?, ?, ?, ?, 'proposed', ?)",
    )
    .run(by.run, by.lane, by.account ?? null, oneLine(title, 200), body, nowIso());
  return Number(r.lastInsertRowid);
}

/** The notes nobody has kept or dropped yet: of one run, or of all. */
export const proposedNotes = (db: Db, runId?: string) =>
  db
    .prepare("select * from memory_notes where status = 'proposed' and (? is null or run_id = ?) order by id")
    .all(runId ?? null, runId ?? null) as unknown as Note[];

/** Write down that a lane was given an entry: "file:<path>" or "note:<id>". */
export function recordRead(db: Db, by: Asker, entry: string): void {
  db.prepare("insert into memory_reads (run_id, lane, account, entry, at) values (?, ?, ?, ?, ?)").run(
    by.run,
    by.lane,
    by.account ?? null,
    entry,
    nowIso(),
  );
}

function proposed(db: Db, id: string): Note {
  const note = db.prepare("select * from memory_notes where id = ?").get(Number(id) || 0) as unknown as
    | Note
    | undefined;
  if (!note || note.status !== "proposed") {
    throw new UserError(
      note ? `Note ${id} was already ${note.status}.` : `There is no note "${id}".`,
      "See the notes that wait with `softwarefactor memory list`.",
    );
  }
  return note;
}

/** A person keeps a note: it becomes a memory file, to review and commit like any other. Returns its path. */
export function keepNote(factorDir: string, db: Db, id: string): string {
  const note = proposed(db, id);
  const dir = join(factorDir, "memory", "notes");
  mkdirSync(dir, { recursive: true });
  const slug =
    note.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "note";
  const name = existsSync(join(dir, `${slug}.md`)) ? `${slug}-${note.id}.md` : `${slug}.md`;
  const origin = `From a note by an agent: run ${note.run_id}, lane ${note.lane}, account ${note.account ?? "none"}. Kept by a person on ${nowIso().slice(0, 10)}.`;
  writeFileSync(join(dir, name), `# ${note.title}\n\n${note.body}\n\n${origin}\n`, { flag: "wx" });
  db.prepare("update memory_notes set status = 'kept' where id = ?").run(note.id);
  return `.factor/memory/notes/${name}`;
}

export function dropNote(db: Db, id: string): void {
  db.prepare("update memory_notes set status = 'dropped' where id = ?").run(proposed(db, id).id);
}

/** The project's memory as a part of a prompt: bodies up to a budget, then titles only. */
export function memorySection(entries: Entry[]): string | undefined {
  if (entries.length === 0) return undefined;
  let left = PROMPT_BUDGET;
  const full: string[] = [];
  const titles: string[] = [];
  for (const e of entries) {
    if (titles.length === 0 && e.body.length <= left) {
      left -= e.body.length;
      full.push(`## ${e.title} (${e.id})\n\n${e.body}`);
    } else titles.push(`- ${e.title} (${e.id})`);
  }
  const more =
    titles.length === 0
      ? []
      : [
          `More, by title only. Read one with the memory_read tool of the factor server, with a word of its title as "query":\n\n${titles.join("\n")}`,
        ];
  return [
    "# What this project remembers\n\nThis is kept by the people of this project, in .factor/memory/. Follow it.",
    ...full,
    ...more,
  ].join("\n\n");
}

/** Notes of this run as a part of a prompt, quoted line by line: they are agents' words. */
export function notesSection(notes: Note[]): string | undefined {
  if (notes.length === 0) return undefined;
  const quoted = notes
    .flatMap((n) => [`${n.title} (lane "${n.lane}")`, ...n.body.split("\n"), ""])
    .map((line) => `> ${line}`.trimEnd());
  return `# Notes from earlier lanes of this run (written by agents, not by the host or a person)\n\n${quoted.join("\n")}`;
}
