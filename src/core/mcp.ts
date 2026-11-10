// The factor MCP server: the one way agents of every vendor read the project's memory, leave a
// note for later lanes, hand off, ask a person and attach evidence (ADR 0007). It speaks JSON-RPC
// over stdio, one message a line. It is started by the agent's CLI for one lane, and which lane
// that is comes from its command line, never from a tool call.
import { lstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import { FACTOR_TOOLS, type FactorTool } from "./agents/factor-tools.ts";
import { type Db, openDb } from "./db.ts";
import { type Asker, addNote, proposedNotes, readMemory, recordRead } from "./memory.ts";
import { readObject } from "./safe-read.ts";

export interface Served extends Asker {
  /** The workspace's root: its .factor folder holds the memory and the database. */
  root: string;
  laneDir: string;
}

const MAX_ATTACHMENT = 1_000_000;
const text = (max: number) => z.string().min(1).max(max);

/** Write a file the lane's folder may already hold, never through a link left in its place. */
function put(dir: string, name: string, content: string): void {
  mkdirSync(dir, { recursive: true });
  if (!lstatSync(dir).isDirectory()) throw new Error("The lane's folder is not a folder any more.");
  rmSync(join(dir, name), { force: true });
  writeFileSync(join(dir, name), content, { flag: "wx" });
}

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
        ...notes.map(
          (n) =>
            `## ${n.title} (a note by the agent of lane "${n.lane}" in this run, not checked by anyone)\n\n${n.body}`,
        ),
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
    run: (args: { handoff: Record<string, unknown> }, at) => {
      // a question that was asked stands: a hand-off after it would hide it from the person
      if (readObject(join(at.laneDir, "handoff.json"))?.value.outcome === "needsPerson") {
        throw new Error("You asked a person a question. End now: the run waits for the answer.");
      }
      put(at.laneDir, "handoff.json", `${JSON.stringify(args.handoff, null, 2)}\n`);
      return "The hand-off is written. The host checks it when you end.";
    },
  },
  ask_question: {
    description:
      "Ask a person something only they can answer. The run waits for the answer, and this lane starts again with it. End your work after calling this.",
    input: z.strictObject({ question: text(2000) }),
    run: (args: { question: string }, at) => {
      put(
        at.laneDir,
        "handoff.json",
        `${JSON.stringify({ outcome: "needsPerson", summary: args.question })}\n`,
      );
      return "The question is written. End now: the run waits for a person.";
    },
  },
  evidence_attach: {
    description:
      'Attach a text file as evidence. A claim in your hand-off can then cite it as "attached:<name>". The name is a plain file name.',
    input: z.strictObject({ name: text(100), text: z.string().max(MAX_ATTACHMENT) }),
    run: (args: { name: string; text: string }, at) => {
      if (/[\\/]/.test(args.name) || args.name.startsWith(".")) {
        throw new Error(`"${args.name}" is not a plain file name.`);
      }
      put(join(at.laneDir, "evidence"), args.name, args.text);
      return `Attached. Cite it as "attached:${args.name}".`;
    },
  },
};

type Message = { id?: unknown; method?: unknown; params?: Record<string, unknown> };

function answer(
  message: Message,
  at: Served,
  db: Db,
): { result: unknown } | { error: { code: number; message: string } } {
  const { method, params } = message;
  if (method === "initialize") {
    return {
      result: {
        // the version the client asked for: the few methods served here are the same in all of them
        protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "factor", version: "1" },
      },
    };
  }
  if (method === "ping") return { result: {} };
  if (method === "tools/list") {
    const tools = FACTOR_TOOLS.map((name) => ({
      name,
      description: TOOLS[name].description,
      inputSchema: z.toJSONSchema(TOOLS[name].input),
    }));
    return { result: { tools } };
  }
  if (method === "tools/call") {
    const name = FACTOR_TOOLS.find((t) => t === params?.name);
    if (!name) return { error: { code: -32602, message: `There is no tool "${String(params?.name)}".` } };
    const said = (words: string, isError = false) => ({
      result: { content: [{ type: "text", text: words }], ...(isError ? { isError: true } : {}) },
    });
    const args = TOOLS[name].input.safeParse(params?.arguments ?? {});
    if (!args.success) {
      const first = args.error.issues[0];
      return said(
        `The arguments are wrong at "${first?.path.join(".") || "(top)"}": ${first?.message}`,
        true,
      );
    }
    try {
      return said(TOOLS[name].run(args.data as never, at, db));
    } catch (error) {
      return said((error as Error).message, true);
    }
  }
  return { error: { code: -32601, message: `This server has no method "${String(method)}".` } };
}

/** Serve one lane until the client closes the stream. */
export async function serve(at: Served): Promise<void> {
  const db = openDb(join(at.root, ".factor", "state.db"));
  const say = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
  try {
    for await (const line of createInterface({ input: process.stdin })) {
      if (line.trim() === "") continue;
      let message: Message;
      try {
        message = JSON.parse(line);
        if (typeof message !== "object" || message === null) throw new Error("not an object");
      } catch {
        say({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "That line is not a JSON object." },
        });
        continue;
      }
      if (message.id === undefined || message.id === null) continue; // a notification: no answer
      say({ jsonrpc: "2.0", id: message.id, ...answer(message, at, db) });
    }
  } finally {
    db.close();
  }
}
