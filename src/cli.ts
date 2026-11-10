#!/usr/bin/env node
// The command line. Every command is a thin layer over a core operation, so the interface and the
// MCP server can offer the same ones (ADR 0008).
import { parseArgs } from "node:util";
import { openDb } from "./core/db.ts";
import { collect, runNext } from "./core/engine/run.ts";
import { UserError } from "./core/errors.ts";
import { interrupt } from "./core/exec.ts";
import { init } from "./core/init.ts";
import { readStatus } from "./core/store.ts";
import { loadWorkspace } from "./core/workspace.ts";

const HELP = `softwarefactor: a software factory you assemble yourself

Usage: softwarefactor <command>

  init      Set up a factory in this repository (.factor/)
  collect   Ask the workflow's collectors for new tasks
  run       Collect, then take the next queued task through the workflow
  status    Show tasks, runs, lanes, gates and where the evidence is

Exit codes for run: 0 the task is done, 1 it stopped, 3 it waits for a person.
`;

// Task titles and agent summaries come from outside. Printed raw, a control sequence in one could
// rewrite the terminal's title or hide a failure line.
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const say = (line: string) => console.log(line.replace(CONTROL, ""));

const EXIT = { none: 0, done: 0, dropped: 0, running: 0, stopped: 1, waiting: 3 } as const;

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { help: { type: "boolean", short: "h" } },
  });
  const command = positionals[0];
  const cwd = process.cwd();
  if (values.help || !command) {
    console.log(HELP);
    return command || values.help ? 0 : 1;
  }

  if (command === "init") {
    const r = init(cwd);
    if (r.already) {
      console.log("This repository already has a factory in .factor/. Nothing was changed.");
      return 0;
    }
    for (const f of r.created) console.log(`created ${f}`);
    if (!r.verifyDetected) {
      console.log(
        "\nNo test command was found. Set commands.verify in .factor/factory.json to your project's checks.",
      );
    } else
      console.log(
        `\nThe verify command is "${r.verify}". Change it in .factor/factory.json if that is wrong.`,
      );
    console.log("Next: commit .factor/, then `softwarefactor run`.");
    return 0;
  }

  if (command === "collect") {
    const ws = loadWorkspace(cwd);
    const db = openDb(ws.dbPath);
    try {
      const added = collect(ws, db);
      console.log(`collected ${added} new task${added === 1 ? "" : "s"}`);
    } finally {
      db.close();
    }
    return 0;
  }

  if (command === "run") {
    const summary = await runNext(loadWorkspace(cwd));
    for (const line of summary.log) say(line);
    return EXIT[summary.status];
  }

  if (command === "status") {
    const ws = loadWorkspace(cwd);
    const db = openDb(ws.dbPath);
    try {
      const view = readStatus(db);
      say("Tasks");
      if (view.tasks.length === 0) say("  (none)");
      for (const t of view.tasks) say(`  ${t.status.padEnd(8)} ${t.title}`);
      say("\nRuns");
      if (view.runs.length === 0) say("  (none)");
      for (const r of view.runs) {
        say(`  ${r.id}  ${r.status.padEnd(8)} ${r.title}  (branch ${r.branch})`);
        if (r.stop_reason) say(`    ${r.stop_reason}`);
        for (const l of r.lanes) {
          say(`    ${l.lane}  ${l.outcome ?? "running"}${l.note ? `  ${l.note}` : ""}`);
          for (const g of l.gates) say(`      ${g.gate}  ${g.status}  exit ${g.exit_code}  ${g.output_path}`);
        }
        for (const i of r.inbox) say(`    waiting: ${i.body}`);
      }
    } finally {
      db.close();
    }
    return 0;
  }

  console.error(`Unknown command "${command}".\n`);
  console.error(HELP);
  return 1;
}

// Ctrl-C or a kill stops what is running and ends the run as stopped, instead of leaving it "running" for ever.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, interrupt);

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    if (error instanceof UserError) console.error(`error: ${error.message}\n  fix: ${error.fix}`);
    else console.error(error);
    process.exitCode = 1;
  },
);
