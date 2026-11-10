// Every operation of the factory, in one table (ADR 0008). The interface's API, the operator MCP
// server and the command line are layers over it, and a test fails when a layer lacks one. An
// operation that reads calls the function the command line prints from. An operation that changes
// something runs the command line's own command in a process of its own: there is one
// implementation, and a run goes on after the interface or the agent that started it has gone.
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import type { Db } from "./db.ts";
import { UserError } from "./errors.ts";
import { listRuns, runDetail, runDiff, runFile } from "./runs/view.ts";
import { type Problem, parseWorkflow } from "./schema/parse.ts";
import { accountsView, costsView, inboxItems, pluginsView } from "./views.ts";
import { factorHome, loadWorkspace, workspaceId } from "./workspace.ts";

export interface At {
  /** The workspace's root: the repository with the `.factor` folder. */
  root: string;
  db: Db;
}
export interface Operation {
  /** Letters, digits and _ only: the name is also the MCP tool's. */
  name: string;
  description: string;
  input: z.ZodType;
  changes: boolean;
  /** The command line's words for the same. A word in <> stands for a value. */
  cli: string[][];
  run: (at: At, input: never) => unknown | Promise<unknown>;
}
const op = <S extends z.ZodType>(
  o: Omit<Operation, "input" | "run"> & { input: S; run: (at: At, input: z.infer<S>) => unknown },
) => o as unknown as Operation;

const none = z.strictObject({});
const NAME = /^[a-z][a-z0-9-]*$/;
const name = z.string().regex(NAME);
const runId = z.string().regex(/^[A-Za-z0-9]{1,64}$/);
// a model's name as a CLI takes it: never a word that could be an option
const model = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/);
const MAX_TEXT = 200_000;
const DECIDE_MS = 30_000;

// ---- workflows as files

/**
 * A workflow's file, when the name is a name and the file is a plain file in this repository's
 * own workflows folder. A link there, or a folder that is a link, leads somewhere else: it is
 * neither read nor written through.
 */
export function workflowFile(root: string, given: string): string | undefined {
  if (!NAME.test(given)) return undefined;
  const folder = join(root, ".factor", "workflows");
  const file = join(folder, `${given}.json`);
  try {
    if (realpathSync(folder) !== join(realpathSync(root), ".factor", "workflows")) return undefined;
    return lstatSync(file).isFile() ? file : undefined;
  } catch {
    return undefined; // not there
  }
}
const noWorkflow = () =>
  new UserError("There is no such workflow.", "See the workflows with the workspace operation.");

export function workspaceInfo(root: string) {
  const folder = join(root, ".factor", "workflows");
  const names = existsSync(folder)
    ? readdirSync(folder)
        .filter((f) => f.endsWith(".json") && workflowFile(root, f.slice(0, -5)))
        .map((f) => f.slice(0, -5))
        .sort()
    : [];
  let workflow = "";
  try {
    const config = JSON.parse(readFileSync(join(root, ".factor", "factory.json"), "utf8")) as {
      workflow?: unknown;
    };
    workflow = String(config.workflow ?? "");
  } catch {
    // no factory file that reads: the list still stands
  }
  return { name: basename(root), root, workflow, workflows: names };
}

export function readWorkflow(root: string, given: string): { workflow: unknown; problems: Problem[] } {
  const file = workflowFile(root, given);
  if (!file) throw noWorkflow();
  let workflow: unknown;
  try {
    workflow = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const problem = {
      path: "(file)",
      message: `The file is not JSON: ${(error as Error).message}`,
      fix: "Fix it in an editor.",
    };
    return { workflow: null, problems: [problem] };
  }
  return { workflow, problems: parseWorkflow(workflow).problems };
}

/** Write a workflow, when the checker the command line uses finds nothing wrong with it. */
export function saveWorkflow(
  root: string,
  given: string,
  workflow: Record<string, unknown>,
): { saved: boolean; workflow: unknown; problems: Problem[] } {
  const file = workflowFile(root, given);
  if (!file) throw noWorkflow();
  const problems = parseWorkflow(workflow).problems;
  if (workflow.name !== given) {
    problems.push({
      path: "name",
      message: `The workflow's name is "${String(workflow.name)}", but its file is ${given}.json.`,
      fix: `Set "name" to "${given}".`,
    });
  }
  if (problems.length > 0) return { saved: false, workflow, problems };
  // written beside and moved into place: never through a link, and never left half written
  const beside = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(beside, `${JSON.stringify(workflow, null, 2)}\n`, { flag: "wx" });
    renameSync(beside, file);
  } catch (error) {
    rmSync(beside, { force: true }); // or the next save would find it in its way
    throw new Error(`The workflow could not be written: ${(error as Error).message}`);
  }
  return { saved: true, workflow, problems: [] };
}

// ---- the command line's own commands, for what changes something

/** What a refused command printed, as the refusal it is. */
function refusal(said: string): UserError | undefined {
  const [, message, fix] = /^error: (.*)\n {2}fix: (.*)$/m.exec(said) ?? [];
  return message === undefined ? undefined : new UserError(message, fix ?? "");
}
const self = () => [process.execPath, process.argv[1] ?? ""] as const;

/** Run a command that ends at once, such as `role bind`. A refusal is thrown as the command worded it. */
function command(root: string, args: string[]): { said: string } {
  const [node, cli] = self();
  const done = spawnSync(node, [cli, ...args], { cwd: root, encoding: "utf8" });
  const refused = refusal(done.stderr ?? "");
  if (refused) throw refused;
  if (done.status !== 0) throw new Error((done.stderr || done.stdout || "the command failed").trim());
  return { said: done.stdout.trim() };
}

let started = 0;
/**
 * Give a decision by the command line's own command, in a process of its own, with what it prints
 * in a file under the factor home. The answer comes when the command has ended, or as soon as it
 * has printed that the decision is recorded: the run then goes on by itself. A refusal is the
 * command's own, so it is never mistaken for a run that goes on, however slow the command starts
 * and whoever else decides at the same moment.
 */
async function decide(at: At, input: { run: string; decision: string; note?: string }) {
  const folder = join(factorHome(), "work", workspaceId(at.root), "decisions");
  mkdirSync(folder, { recursive: true });
  started += 1;
  const log = join(folder, `${Date.now()}-${process.pid}-${started}.log`);
  const out = openSync(log, "wx", 0o600);
  const [node, cli] = self();
  // the note is one word of the command line, joined to its flag: it may start with anything
  const args = [input.decision, input.run, ...(input.note ? [`--note=${input.note}`] : [])];
  const child = spawn(node, [cli, ...args], { cwd: at.root, detached: true, stdio: ["ignore", out, out] });
  closeSync(out);
  child.unref();
  let code: number | null | undefined;
  child.on("exit", (exit) => {
    code = exit;
  });
  child.on("error", () => {
    code = 1;
  });
  for (const begun = Date.now(); Date.now() - begun < DECIDE_MS; ) {
    await new Promise((again) => setTimeout(again, 40));
    const said = readFileSync(log, "utf8");
    if (code !== undefined) {
      const refused = refusal(said);
      if (refused) throw refused;
      return { state: "ended" as const, run: code === 0 ? "done" : code === 3 ? "waiting" : "stopped" };
    }
    if (TAKEN.test(said)) return { state: "going" as const };
  }
  return { state: "going" as const };
}
// what the command prints, at once, when a decision is recorded
const TAKEN = /^run \S+: (approved|rejected|sent back|answered)/m;

const missingRun = (run: string) =>
  new UserError(`There is no run "${run}".`, "See the runs with the runs_list operation.");

export const OPERATIONS: Operation[] = [
  op({
    name: "workspace",
    description: "The workspace: its name, its folder, the workflow in use and the workflows it has.",
    input: none,
    changes: false,
    cli: [["status"]],
    run: (at) => workspaceInfo(at.root),
  }),
  op({
    name: "workflow_get",
    description: "Read one workflow as JSON, with the problems the checker finds in it.",
    input: z.strictObject({ name }),
    changes: false,
    cli: [["check"]],
    run: (at, input) => readWorkflow(at.root, input.name),
  }),
  op({
    name: "workflow_check",
    description:
      "Check a workflow given as JSON: each problem with its place and its fix. Nothing is written.",
    input: z.strictObject({ workflow: z.record(z.string(), z.unknown()) }),
    changes: false,
    cli: [["check"]],
    run: (_at, input) => ({ problems: parseWorkflow(input.workflow).problems }),
  }),
  op({
    name: "workflow_save",
    description:
      "Save a workflow under its name. It is written only when the checker finds no problem: otherwise the problems come back.",
    input: z.strictObject({ name, workflow: z.record(z.string(), z.unknown()) }),
    changes: true,
    cli: [["check"]],
    run: (at, input) => saveWorkflow(at.root, input.name, input.workflow),
  }),
  op({
    name: "runs_list",
    description:
      "The runs: every one that is moving or waiting and the latest ended ones, each with where it is and one sentence about what is happening.",
    input: none,
    changes: false,
    cli: [["runs"]],
    run: (at) => ({ runs: listRuns(at.db, at.root) }),
  }),
  op({
    name: "runs_get",
    description:
      "One run: each lane it went through with its gates, claims, sessions and hand-off, what waits for a person, and its evidence files.",
    input: z.strictObject({ run: runId }),
    changes: false,
    cli: [["runs", "<run>"]],
    run: (at, input) => {
      const run = runDetail(at.db, at.root, input.run);
      if (!run) throw missingRun(input.run);
      return { run };
    },
  }),
  op({
    name: "runs_file",
    description:
      "Read one file of a run (a gate's output, a hand-off, attached evidence) by the path the run gives for it. Text comes as text. For a picture or a recording only its type and size come.",
    input: z.strictObject({ run: runId, path: z.string().min(1).max(1000) }),
    changes: false,
    cli: [["runs", "<run>"]],
    run: (at, input) => {
      const file = runFile(at.db, at.root, input.run, input.path);
      if (!file)
        throw new UserError(
          "There is no such file in this run.",
          "Take the path from the runs_get operation.",
        );
      if (file === "too large")
        throw new UserError(
          "This file is too large to read here.",
          "Open it from the run's folder under .factor/runs.",
        );
      if (!file.type.startsWith("text/")) return { type: file.type, bytes: file.data.length };
      const text = file.data.toString("utf8");
      return { type: file.type, text: text.slice(0, MAX_TEXT), cut: text.length > MAX_TEXT };
    },
  }),
  op({
    name: "runs_diff",
    description:
      "What a run changed, from its base commit to its head: every changed file by name, and the diff.",
    input: z.strictObject({ run: runId }),
    changes: false,
    cli: [["runs", "<run>", "--diff"]],
    run: (at, input) => {
      const diff = runDiff(at.db, at.root, input.run);
      if (!diff) throw missingRun(input.run);
      return diff;
    },
  }),
  op({
    name: "inbox_list",
    description:
      "What waits for a person: approvals and questions, each with its run, its lane and the decisions it takes.",
    input: none,
    changes: false,
    cli: [["inbox"]],
    run: (at) => ({ items: inboxItems(at.db) }),
  }),
  op({
    name: "inbox_decide",
    description:
      "Decide on a run that waits: approve, reject, send-back (with a note for the lane) or answer (a question, with the answer as the note). The run then goes on by itself.",
    input: z.strictObject({
      run: runId,
      decision: z.enum(["approve", "reject", "send-back", "answer"]),
      note: z.string().max(20_000).optional(),
    }),
    changes: true,
    cli: [
      ["approve", "<run>"],
      ["reject", "<run>"],
      ["send-back", "<run>"],
      ["answer", "<run>"],
    ],
    run: decide,
  }),
  op({
    name: "accounts_list",
    description:
      "The agent logins on this machine with their limits and what they have used, and which one works each role of the workflow. Never where a login is kept.",
    input: none,
    changes: false,
    cli: [
      ["account", "list"],
      ["role", "list"],
    ],
    run: (at) => accountsView(loadWorkspace(at.root)),
  }),
  op({
    name: "roles_bind",
    description:
      "Say which account works a role of the workflow in this workspace, with a model for each size of lane and an effort if wanted.",
    input: z.strictObject({
      role: name,
      account: name,
      small: model.optional(),
      medium: model.optional(),
      large: model.optional(),
      effort: z
        .string()
        .regex(/^[a-z]{1,20}$/)
        .optional(),
    }),
    changes: true,
    cli: [["role", "bind"]],
    run: (at, input) => {
      const flags = (["small", "medium", "large", "effort"] as const).flatMap((key) =>
        input[key] ? [`--${key}=${input[key]}`] : [],
      );
      return command(at.root, ["role", "bind", input.role, `--account=${input.account}`, ...flags]);
    },
  }),
  op({
    name: "costs",
    description:
      "Tokens and cost by lane, by task and by account, from the session records, with the whole and how many sessions have no known cost.",
    input: none,
    changes: false,
    cli: [["cost"]],
    run: (at) => costsView(at.db),
  }),
  op({
    name: "plugins_list",
    description:
      "What is built in to assemble a factory from: lane types, gate types, collectors, agents and the workflows that come with this version.",
    input: none,
    changes: false,
    cli: [["plugins"]],
    run: () => pluginsView(),
  }),
];

/** What went wrong with an input, at its first problem: where, and why. */
export function inputProblem(issues: { path: PropertyKey[]; message: string }[]): {
  path: string;
  error: string;
} {
  const first = issues[0];
  return { path: first?.path.join(".") || "(top)", error: first?.message ?? "The input is wrong." };
}
