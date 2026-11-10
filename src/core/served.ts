// What an agent gave the factor server for one start of a lane: a hand-off, a question, files as
// evidence. The server runs outside any sandbox and must never write where an agent can put a
// link, so it writes nothing to disk: these are rows, and the host reads them when the agent ends.
import { nowIso } from "./clock.ts";
import type { Db } from "./db.ts";

const MAX_FILES = 20;
type Kind = "handoff" | "question" | "evidence";

/** `slot` names one start of one lane: the lane folder the host made for it. */
export interface Slot {
  run: string;
  lane: string;
  slot: string;
}

const rows = (db: Db, at: Pick<Slot, "run" | "slot">, kind: Kind) =>
  db
    .prepare("select name, content from served where run_id = ? and slot = ? and kind = ? order by id")
    .all(at.run, at.slot, kind) as unknown as { name: string; content: string }[];

/** Keep something the agent gave. Throws with the reason when it is refused. */
export function serve(db: Db, at: Slot, kind: Kind, content: string, name = ""): void {
  if (kind === "handoff" && rows(db, at, "question").length > 0) {
    // a question that was asked stands: a hand-off after it would hide it from the person
    throw new Error("You asked a person a question. End now: the run waits for the answer.");
  }
  if (kind === "evidence") {
    db.prepare("delete from served where run_id = ? and slot = ? and kind = 'evidence' and name = ?").run(
      at.run,
      at.slot,
      name,
    );
    if (rows(db, at, "evidence").length >= MAX_FILES)
      throw new Error(`A lane can attach at most ${MAX_FILES} files.`);
  }
  db.prepare(
    "insert into served (run_id, lane, slot, kind, name, content, at) values (?, ?, ?, ?, ?, ?, ?)",
  ).run(at.run, at.lane, at.slot, kind, name, content, nowIso());
}

/** Forget what an earlier start left under the same name. */
export function clearServed(db: Db, at: Pick<Slot, "run" | "slot">): void {
  db.prepare("delete from served where run_id = ? and slot = ?").run(at.run, at.slot);
}

/** What the agent gave the server: its hand-off (a question wins, then the last hand-off) and its files. */
export function servedFor(
  db: Db,
  at: Pick<Slot, "run" | "slot">,
): { handoff?: { text: string; value: Record<string, unknown> }; evidence: Record<string, string> } {
  const question = rows(db, at, "question").at(-1)?.content;
  const text =
    question !== undefined
      ? JSON.stringify({ outcome: "needsPerson", summary: question })
      : rows(db, at, "handoff").at(-1)?.content;
  return {
    handoff: text === undefined ? undefined : { text, value: JSON.parse(text) },
    evidence: Object.fromEntries(rows(db, at, "evidence").map((e) => [e.name, e.content])),
  };
}
