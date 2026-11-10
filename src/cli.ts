#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
// The command line. Every command is a thin layer over a core operation, so the interface and the
// MCP server can offer the same ones (ADR 0008).
import { parseArgs } from "node:util";
import { judge, type Verdict } from "./core/agents/guard.ts";
import { accountCommand, memoryCommand, roleCommand, sessionsCommand } from "./core/commands.ts";
import { openDb } from "./core/db.ts";
import { decide } from "./core/engine/inbox.ts";
import { handoffPath, riskLine } from "./core/engine/report.ts";
import { collect } from "./core/engine/run.ts";
import { runNext } from "./core/engine/schedule.ts";
import { stopRun } from "./core/engine/stop.ts";
import { UserError } from "./core/errors.ts";
import { interrupt } from "./core/exec.ts";
import { repoRoot } from "./core/git.ts";
import { init } from "./core/init.ts";
import { serve } from "./core/mcp.ts";
import { reportFiles } from "./core/schema/check-files.ts";
import { openInbox, readStatus } from "./core/store.ts";
import { loadWorkspace } from "./core/workspace.ts";

const HELP = `softwarefactor: a software factory you assemble yourself

Usage: softwarefactor <command>

  init                     Set up a factory in this repository (.factor/)
  check [files]            Check workflow files: each problem with its place and fix
  collect                  Ask the workflow's collectors for new tasks
  run [--all] [--parallel N]
                           Pick up runs a crash left, wake waits that are due, then take the next
                           queued task through the workflow. With --all, keep going until the queue
                           is empty, several runs at once
  stop <run>               Stop a run that is working or waiting
  status                   Show tasks, runs, lanes, gates and where the evidence is
  memory list | keep <id> | drop <id>
                           Show what the project remembers and what agents have proposed, and keep
                           or drop a proposed note
  sessions [run]           Show each start of an agent: account, model, tokens by kind and cost,
                           with a total per run and per account
  inbox                    Show what waits for a person
  approve <run>            Approve a waiting lane
  reject <run> [--note]    Reject it: the lane's fail transition is taken
  send-back <run> --note   Run the lane again with your note
  answer <run> --note      Answer a lane's question and run it again
  account add <name> --agent claude|codex|kimi|command --profile <folder>
          [--limit 5h=2000000] [--headroom 0.9] [--bin <path>] [--command "<shell command>"]
                           Name an agent login on this machine. The login stays in the CLI's own
                           profile folder: the factory stores only where it is
  account list | remove <name>
  role bind <role> --account <name> [--small <model>] [--medium <model>] [--large <model>] [--effort <level>]
                           Say which account works a role of the workflow, in this workspace
  role list                Show each role, its account, and any role that should be on another vendor

Exit codes for run and for a decision: 0 the task is done or dropped, 1 it stopped, 3 it waits.
`;

// Task titles and agent summaries come from outside. Printed raw, a control sequence in one could
// rewrite the terminal's title or hide a failure line.
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;
const say = (line: string) => console.log(line.replace(CONTROL, ""));

const EXIT = { none: 0, done: 0, dropped: 0, running: 0, stopped: 1, waiting: 3 } as const;

/**
 * The hook an agent CLI calls before each tool call: the call on stdin, the lane on the command
 * line (never from the environment, which an agent can set). Exit 0 allows. Exit 2 denies, with the
 * reason on stderr for the agent. Nothing else is ever returned, because a CLI reads any other code
 * as "the hook broke, carry on".
 */
function guard(args: string[]): number {
  let verdict: Verdict;
  try {
    const named: Record<string, string[]> = { worktree: [], "lane-dir": [], access: [], protect: [] };
    for (let i = 0; i < args.length; i += 2) {
      const list = named[(args[i] ?? "").replace(/^--/, "")];
      const value = args[i + 1];
      if (!list || !args[i]?.startsWith("--") || value === undefined)
        throw new Error("its command line is wrong");
      list.push(value);
    }
    const [worktree] = named.worktree ?? [];
    const [laneDir] = named["lane-dir"] ?? [];
    const [access] = named.access ?? [];
    if (!worktree || !laneDir || (access !== "read" && access !== "write")) {
      throw new Error("the guard was not told where the lane works");
    }
    const call: unknown = JSON.parse(readFileSync(0, "utf8"));
    if (typeof call !== "object" || call === null) throw new Error("the tool call is not an object");
    const { tool_name, tool_input } = call as Record<string, unknown>;
    verdict = judge(
      { tool: tool_name, input: tool_input },
      { worktree, laneDir, access, defaultBranch: named.protect ?? [] },
    );
  } catch (error) {
    verdict = {
      allow: false,
      reason: `The guard could not read this tool call, so it is denied: ${(error as Error).message}`,
    };
  }
  if (verdict.allow) return 0;
  console.error(verdict.reason ?? "Denied by the guard.");
  return 2;
}

/** The factor MCP server for one lane. An agent's CLI starts it: see docs/memory.md. */
async function mcpCommand(args: string[]): Promise<number> {
  const named: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) named[(args[i] ?? "").replace(/^--/, "")] = args[i + 1] ?? "";
  const { workspace: root, run, lane, "lane-dir": laneDir, account } = named;
  if (!root || !run || !lane || !laneDir) {
    console.error("softwarefactor mcp needs --workspace, --run, --lane and --lane-dir: the lane it serves.");
    return 1;
  }
  await serve({ root, run, lane, laneDir, account: account || undefined });
  return 0;
}

async function main(): Promise<number> {
  if (process.argv[2] === "guard") return guard(process.argv.slice(3));
  if (process.argv[2] === "mcp") return mcpCommand(process.argv.slice(3));
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      note: { type: "string" },
      all: { type: "boolean" },
      parallel: { type: "string" },
      agent: { type: "string" },
      profile: { type: "string" },
      bin: { type: "string" },
      command: { type: "string" },
      limit: { type: "string", multiple: true },
      headroom: { type: "string" },
      account: { type: "string" },
      small: { type: "string" },
      medium: { type: "string" },
      large: { type: "string" },
      effort: { type: "string" },
    },
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

  if (command === "account") return accountCommand(positionals.slice(1), values, say);
  if (command === "role") return roleCommand(loadWorkspace(cwd), positionals.slice(1), values, say);

  if (command === "memory") {
    const ws = loadWorkspace(cwd);
    const db = openDb(ws.dbPath);
    try {
      return memoryCommand(ws, db, positionals.slice(1), say);
    } finally {
      db.close();
    }
  }

  if (command === "sessions") {
    const db = openDb(loadWorkspace(cwd).dbPath);
    try {
      return sessionsCommand(db, positionals[1], say);
    } finally {
      db.close();
    }
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

  if (command === "check") {
    const files = positionals.slice(1);
    if (files.length === 0) {
      const dir = join(repoRoot(cwd), ".factor", "workflows");
      if (existsSync(dir)) {
        for (const f of readdirSync(dir).sort())
          if (f.endsWith(".json")) files.push(relative(cwd, join(dir, f)));
      }
    }
    return reportFiles(files, say) > 0 ? 1 : 0;
  }

  if (command === "inbox") {
    const ws = loadWorkspace(cwd);
    const db = openDb(ws.dbPath);
    try {
      const items = openInbox(db);
      if (items.length === 0) say("Nothing waits for you.");
      for (const i of items) say(`${i.run_id}  ${i.kind.padEnd(8)} ${i.lane}  ${i.title}\n    ${i.body}`);
    } finally {
      db.close();
    }
    return 0;
  }

  if (command === "approve" || command === "reject" || command === "send-back" || command === "answer") {
    const runId = positionals[1];
    if (!runId)
      throw new UserError(`"${command}" needs a run id.`, "See what is waiting with `softwarefactor inbox`.");
    const summary = await decide(loadWorkspace(cwd), runId, command, values.note ?? "");
    for (const line of summary.log) say(line);
    return EXIT[summary.status];
  }

  if (command === "stop") {
    const runId = positionals[1];
    if (!runId)
      throw new UserError('"stop" needs a run id.', "See the run ids with `softwarefactor status`.");
    say(await stopRun(loadWorkspace(cwd), runId));
    return 0;
  }

  if (command === "run") {
    const parallel = values.parallel === undefined ? undefined : Number(values.parallel);
    if (parallel !== undefined && !(Number.isInteger(parallel) && parallel >= 1)) {
      throw new UserError(
        `--parallel needs a whole number of 1 or more, not "${values.parallel}".`,
        "For example: --parallel 2.",
      );
    }
    const summary = await runNext(loadWorkspace(cwd), { all: values.all, parallel });
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
        if (r.stop_reason) say(`    ${r.stop_code ?? "ended"}: ${r.stop_reason}`);
        say(`    ${riskLine(r.risk ? JSON.parse(r.risk) : null)}`);
        const report = handoffPath(ws, r.id);
        if (existsSync(report)) say(`    hand-off: ${relative(ws.root, report)}`);
        for (const l of r.lanes) {
          say(`    ${l.lane}  ${l.outcome ?? "running"}${l.note ? `  ${l.note}` : ""}`);
          for (const g of l.gates) {
            // only a command gate's exit code says pass or fail: for the others it would mislead
            const exit = g.uses === "core/command@1" ? `  exit ${g.exit_code}` : "";
            say(`      ${g.gate}  ${g.status}${exit}  ${g.output_path}`);
          }
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
    process.exitCode = process.argv[2] === "guard" ? 2 : 1; // the guard never fails open
  },
);
