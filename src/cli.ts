#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
// The command line. Every command is a thin layer over a core operation, so the interface and the
// MCP server can offer the same ones (ADR 0008).
import { parseArgs } from "node:util";
import { judge, type Verdict } from "./core/agents/guard.ts";
import { mcpCall } from "./core/collectors/mcp-call.ts";
import {
  accountCommand,
  allowCommand,
  memoryCommand,
  roleCommand,
  sessionsCommand,
} from "./core/commands.ts";
import { pluginsCommand, runsCommand } from "./core/commands-view.ts";
import { costCheck, costCommand, costJson } from "./core/cost.ts";
import { openDb } from "./core/db.ts";
import { decide } from "./core/engine/inbox.ts";
import { handoffPath, riskLine } from "./core/engine/report.ts";
import { collect } from "./core/engine/run.ts";
import { runNext } from "./core/engine/schedule.ts";
import { requeueRun, stopRun } from "./core/engine/stop.ts";
import { UserError } from "./core/errors.ts";
import { evalCommand } from "./core/eval/index.ts";
import { interrupt } from "./core/exec.ts";
import { repoRoot } from "./core/git.ts";
import { HELP } from "./core/help.ts";
import { init } from "./core/init.ts";
import { escapeCommand, ladderCommand } from "./core/ladder.ts";
import { serve } from "./core/mcp.ts";
import { serveOperator } from "./core/mcp-operator.ts";
import { addCommand, availableCommand } from "./core/plugins/install.ts";
import { retroCommand } from "./core/retro.ts";
import { reportFiles } from "./core/schema/check-files.ts";
import { startServer } from "./core/server.ts";
import { exportCommand, importCommand } from "./core/sharing.ts";
import { openInbox, readStatus } from "./core/store.ts";
import { factorHome, loadWorkspace, locateWorkspace, workflowHere } from "./core/workspace.ts";

// Task titles and agent summaries come from outside. Printed raw, a control sequence in one could
// rewrite the terminal's title or hide a failure line.
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;
const say = (line: string) => console.log(line.replace(CONTROL, ""));

const READ_ONLY = new Set(["check", "status", "sessions", "inbox", "runs", "cost", "plugins"]);
const LISTS = new Set(["memory", "account", "role"]);
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
      { worktree, laneDir, access, defaultBranch: named.protect ?? [], self: process.argv[1] },
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
  if (args.includes("--operator")) {
    // the operator server decides as the person at this machine: an agent inside a run gets no such thing
    if (process.env.FACTOR_RUN_ID || process.env.FACTOR_LANE) {
      console.error(
        "softwarefactor mcp --operator was started inside a run. It is for your own agent, outside one.",
      );
      return 1;
    }
    const root = args[args.indexOf("--workspace") + 1];
    // a run's worktree holds the factory's files too, but it is where an agent works, not a workspace
    // by what the folders really are: a link or another spelling of the path names the same place
    const real = (path: string) => (existsSync(path) ? realpathSync(path) : resolve(path));
    if (root && real(root).startsWith(`${real(join(factorHome(), "work"))}${sep}`)) {
      console.error(
        "softwarefactor mcp --operator was given the worktree of a run. Give it your own repository.",
      );
      return 1;
    }
    if (!args.includes("--workspace") || !root || !existsSync(join(root, ".factor", "factory.json"))) {
      console.error("softwarefactor mcp --operator needs --workspace <folder>: a repository with a factory.");
      return 1;
    }
    await serveOperator(repoRoot(root));
    return 0;
  }
  const named: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) named[(args[i] ?? "").replace(/^--/, "")] = args[i + 1] ?? "";
  const { workspace: root, run, lane, "lane-dir": laneDir, account } = named;
  if (!root || !run || !lane || !laneDir) {
    console.error("softwarefactor mcp needs --workspace, --run, --lane and --lane-dir: the lane it serves.");
    return 1;
  }
  // started from inside a lane, it serves that lane and no other
  const { FACTOR_RUN_ID: inRun, FACTOR_LANE: inLane } = process.env;
  if ((inRun && inRun !== run) || (inLane && inLane !== lane)) {
    console.error(
      "softwarefactor mcp was started inside one lane to serve another. It serves its own lane only.",
    );
    return 1;
  }
  await serve({ root, run, lane, laneDir, account: account || undefined });
  return 0;
}

async function main(): Promise<number> {
  if (process.argv[2] === "version" || process.argv[2] === "--version") {
    // before parseArgs, so what follows is ignored; from dist/ or src/ alike, ../package.json is the package root's
    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    console.log(version);
    return 0;
  }
  if (process.argv[2] === "guard") return guard(process.argv.slice(3));
  if (process.argv[2] === "mcp") return mcpCommand(process.argv.slice(3));
  if (process.argv[2] === "mcp-call") return mcpCall(); // the factory's own, for a collector
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      yes: { type: "boolean" },
      lane: { type: "string" },
      lesson: { type: "string" },
      break: { type: "string" },
      list: { type: "boolean" },
      save: { type: "string" },
      compare: { type: "string" },
      hash: { type: "string" },
      skill: { type: "string" },
      available: { type: "boolean" },
      out: { type: "string" },
      use: { type: "boolean" },
      "keep-checkpoints": { type: "boolean" },
      note: { type: "string" },
      all: { type: "boolean" },
      parallel: { type: "string" },
      task: { type: "string" },
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
      port: { type: "string" },
      diff: { type: "boolean" },
      check: { type: "boolean" },
      json: { type: "boolean" },
      item: { type: "string" },
    },
  });
  const command = positionals[0];
  const cwd = process.cwd();
  if (values.help || !command) {
    console.log(HELP);
    return command || values.help ? 0 : 1;
  }
  // Inside a run only looking is allowed: an agent, or a command a lane runs, must not approve its
  // own work, keep its own note or change who works a role. (A wall for accidents and plain
  // attempts: a shell can drop the variable.)
  const looks = READ_ONLY.has(command) || (positionals[1] === "list" && LISTS.has(command));
  if (process.env.FACTOR_RUN_ID && !looks) {
    throw new UserError(
      `"softwarefactor ${command}" was started from inside a run, where only a person's commands that look are allowed.`,
      "Run it yourself, in a terminal of your own.",
    );
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

  if (command === "ui") {
    const root = repoRoot(cwd);
    const file = join(root, ".factor", "factory.json");
    if (!existsSync(file))
      throw new UserError("This repository has no factory yet.", "Run `softwarefactor init`.");
    const port = values.port === undefined ? 4390 : Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new UserError(`--port needs a port number, not "${values.port}".`, "For example: --port 4390.");
    }
    const served = await startServer(root, { workflow: workflowHere(root) }, port);
    // the address carries this session's key after the "#": it is printed here and nowhere else
    say(`Software Factor.io is open at ${served.address}`);
    say("Open that address as it is: the part after # is this session's key. Ctrl-C closes it.");
    // it serves until it is stopped: the factory's other commands keep working beside it
    return new Promise((done) => {
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.on(signal, () => {
          served.close();
          done(0);
        });
      }
    });
  }

  if (command === "account") return accountCommand(positionals.slice(1), values, say);
  if (command === "role") return roleCommand(loadWorkspace(cwd), positionals.slice(1), values, say);
  if (command === "allow") return allowCommand(loadWorkspace(cwd), positionals.slice(1), values, say);

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

  if (command === "ladder" || command === "escape" || command === "retro") {
    const ws = loadWorkspace(cwd);
    const db = openDb(ws.dbPath);
    try {
      if (command === "retro") return retroCommand(ws, db, positionals.slice(1), values, say);
      return command === "ladder"
        ? ladderCommand(ws, db, positionals.slice(1), say)
        : escapeCommand(ws, db, positionals.slice(1), values, say);
    } finally {
      db.close();
    }
  }

  if (command === "collect") {
    const ws = loadWorkspace(cwd);
    const db = openDb(ws.dbPath);
    try {
      for (const line of collect(ws, db)) console.log(line);
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

  if (command === "runs" || command === "cost") {
    if (command === "cost" && values.json && values.check)
      throw new UserError(
        '"--json" and "--check" cannot be used together: --check proves the report and prints sentences, --json prints the report.',
        "Run them one after the other.",
      );
    const ws = loadWorkspace(cwd);
    // A read of the record must not write one: with none, cost reads an empty database in memory.
    const db = openDb(command === "cost" && !existsSync(ws.dbPath) ? ":memory:" : ws.dbPath);
    try {
      if (command === "cost" && values.json) {
        console.log(costJson(db)); // not `say`: it strips control characters, and a document must not change
        return 0;
      }
      if (command === "cost") return values.check ? costCheck(ws, db, say) : costCommand(db, say);
      return runsCommand(db, ws.root, positionals[1], values.diff === true, say);
    } finally {
      db.close();
    }
  }
  if (command === "eval") return evalCommand(values, say);
  if (command === "plugins") return values.available ? availableCommand(say) : pluginsCommand(cwd, say);
  if (command === "add") return addCommand(loadWorkspace(cwd), positionals.slice(1), values, say);
  if (command === "export") return exportCommand(locateWorkspace(cwd), positionals.slice(1), values, say);
  if (command === "import") return importCommand(locateWorkspace(cwd), positionals.slice(1), values, say);

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
    // the line that says the decision is recorded is printed at once: the interface waits for it
    const item = values.item === undefined ? undefined : Number(values.item);
    if (values.item !== undefined && !/^[1-9]\d*$/.test(values.item)) {
      throw new UserError(
        `--item needs the number of an inbox item, not "${values.item}".`,
        "Leave it out to decide on whatever the run waits on.",
      );
    }
    const summary = await decide(loadWorkspace(cwd), runId, command, values.note ?? "", say, item);
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

  if (command === "requeue") {
    const runId = positionals[1];
    if (!runId)
      throw new UserError('"requeue" needs a run id.', "See the run ids with `softwarefactor status`.");
    say(requeueRun(loadWorkspace(cwd), runId));
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
    const summary = await runNext(loadWorkspace(cwd), { all: values.all, parallel, task: values.task });
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
            // only a command's exit code says pass or fail (a plugin's gate is one): for the others it would mislead
            const exit =
              g.uses === "core/command@1" || !g.uses.startsWith("core/") ? `  exit ${g.exit_code}` : "";
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
