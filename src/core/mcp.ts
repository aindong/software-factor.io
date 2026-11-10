// The factor MCP server: the one way agents of every vendor read the project's memory, leave a
// note for later lanes, hand off, ask a person and attach evidence (ADR 0007). It speaks JSON-RPC
// over stdio, one message a line. It is started by the agent's CLI for one lane, and which lane
// that is comes from its command line, never from a tool call. It runs outside any sandbox, so it
// writes no file: what an agent gives it is kept as rows, which the host reads when the agent ends.
import { join } from "node:path";
import { z } from "zod";
import { FACTOR_TOOLS, type FactorTool } from "./agents/factor-tools.ts";
import { type Db, openDb } from "./db.ts";
import { serveTools } from "./mcp-loop.ts";
import { type Asker, addNote, lines, proposedNotes, quoted, readMemory, recordRead } from "./memory.ts";
import { serve as keep } from "./served.ts";

export interface Served extends Asker {
  /** The workspace's root: its .factor folder holds the memory and the database. */
  root: string;
  /** The lane folder the host made for this start of the lane. It names the start: nothing is written there. */
  laneDir: string;
}

const MAX_ATTACHMENT = 1_000_000;
const text = (max: number) => z.string().min(1).max(max);
const slotOf = (at: Served) => ({ run: at.run, lane: at.lane, slot: at.laneDir });

const TOOLS: Record<
  FactorTool,
  { description: string; input: z.ZodType; run: (args: never, at: Served, db: Db) => string }
> = {
  memory_read: {
    description:
      "Read what this project remembers (lessons, decisions, facts) and the notes earlier lanes of this run left. Give `query` to get only entries with that word.",
    input: z.strictObject({ query: text(200).optional() }),
    run: (args: { query?: string }, at, db) => {
      const wanted = (s: string) => !args.query || s.toLowerCase().includes(args.query.toLowerCase());
      const kept = readMemory(join(at.root, ".factor")).filter((e) => wanted(`${e.title}\n${e.body}`));
      const notes = proposedNotes(db, at.run).filter((n) => wanted(`${n.title}\n${n.body}`));
      for (const e of kept) recordRead(db, at, `file:${e.id}`);
      for (const n of notes) recordRead(db, at, `note:${n.id}`);
      if (kept.length + notes.length === 0) return "Nothing in memory matches.";
      return [
        ...kept.map((e) => `## ${e.title} (${e.id}, kept by the project)\n\n${e.body}`),
        // a note is an agent's words: quoted on every line, so it cannot pass for a kept entry
        ...notes.map((n) => {
          const head = `## A note by the agent of lane "${n.lane}" in this run (not checked by anyone)`;
          return `${head}\n\n${quoted([n.title, "", ...lines(n.body)])}`;
        }),
      ].join("\n\n");
    },
  },
  memory_note: {
    description:
      "Leave a note for the lanes that come after you in this run: a fact you found that they would otherwise have to find again. A person decides later whether the project keeps it.",
    input: z.strictObject({ title: text(200), body: text(100_000) }),
    run: (args: { title: string; body: string }, at, db) =>
      `Noted as ${addNote(db, at, args.title, args.body)}. Later lanes of this run will see it.`,
  },
  handoff_write: {
    description:
      "Hand off: give your hand-off as an object with `outcome` (pass, fail or needsPerson) and `summary`, and optionally `claims`, `open`, `risk`, `outputs`. The host checks it. Call this once, when you are done.",
    input: z.strictObject({ handoff: z.record(z.string(), z.unknown()) }),
    run: (args: { handoff: Record<string, unknown> }, at, db) => {
      keep(db, slotOf(at), "handoff", JSON.stringify(args.handoff, null, 2));
      return "The hand-off is kept. The host checks it when you end.";
    },
  },
  ask_question: {
    description:
      "Ask a person something only they can answer. The run waits for the answer, and this lane starts again with it. End your work after calling this.",
    input: z.strictObject({ question: text(2000) }),
    run: (args: { question: string }, at, db) => {
      keep(db, slotOf(at), "question", args.question);
      return "The question is kept. End now: the run waits for a person.";
    },
  },
  evidence_attach: {
    description:
      'Attach a text file as evidence. A claim in your hand-off can then cite it as "attached:<name>". The name is a plain file name.',
    input: z.strictObject({ name: text(100), text: z.string().max(MAX_ATTACHMENT) }),
    run: (args: { name: string; text: string }, at, db) => {
      if (/[\\/]/.test(args.name) || args.name.startsWith(".")) {
        throw new Error(`"${args.name}" is not a plain file name.`);
      }
      keep(db, slotOf(at), "evidence", args.text, args.name);
      return `Attached. Cite it as "attached:${args.name}".`;
    },
  },
};

/** Serve one lane until the client closes the stream. */
export async function serve(at: Served): Promise<void> {
  const db = openDb(join(at.root, ".factor", "state.db"));
  try {
    await serveTools(
      FACTOR_TOOLS.map((name) => ({
        name,
        description: TOOLS[name].description,
        input: TOOLS[name].input,
        run: (args: never) => TOOLS[name].run(args, at, db),
      })),
    );
  } finally {
    db.close();
  }
}
