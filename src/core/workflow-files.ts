// A workflow as a file in this repository's own workflows folder: found, read with its problems
// and its version, and written when the checker finds nothing wrong. Used by the operations.
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { UserError } from "./errors.ts";
import { type Problem, parseWorkflow } from "./schema/parse.ts";
import { workflowHere } from "./workspace.ts";

export const NAME = /^[a-z][a-z0-9-]*$/;

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
export const noWorkflow = () =>
  new UserError("There is no such workflow.", "See the workflows with the workspace operation.");

export function workspaceInfo(root: string) {
  const folder = join(root, ".factor", "workflows");
  const names = existsSync(folder)
    ? readdirSync(folder)
        .filter((f) => f.endsWith(".json") && workflowFile(root, f.slice(0, -5)))
        .map((f) => f.slice(0, -5))
        .sort()
    : [];
  const workflow = workflowHere(root); // empty when no factory file reads: the list still stands
  return { name: basename(root), root, workflow, workflows: names };
}

/** The version of a workflow's file: what a save names to say which text it began from. */
const versionOf = (text: string) => createHash("sha256").update(text).digest("hex");

export function readWorkflow(
  root: string,
  given: string,
): { workflow: unknown; problems: Problem[]; version: string } {
  const file = workflowFile(root, given);
  if (!file) throw noWorkflow();
  const text = readFileSync(file, "utf8");
  const version = versionOf(text);
  let workflow: unknown;
  try {
    workflow = JSON.parse(text);
  } catch (error) {
    const problem = {
      path: "(file)",
      message: `The file is not JSON: ${(error as Error).message}`,
      fix: "Fix it in an editor.",
    };
    return { workflow: null, problems: [problem], version };
  }
  return { workflow, problems: parseWorkflow(workflow).problems, version };
}

/** Write a workflow, when the checker the command line uses finds nothing wrong with it. */
/** A save that began from a version of the file that is no longer the file's. */
export class Changed extends UserError {
  version: string;
  constructor(version: string) {
    super(
      "The workflow's file was changed since this copy of it was read.",
      "Read it again and make the change there, or save over it.",
    );
    this.version = version;
  }
}

export function saveWorkflow(
  root: string,
  given: string,
  workflow: Record<string, unknown>,
  /** The version the change began from, when the caller knows it, and whether to save over a newer file. */
  from: { base?: string; over?: boolean } = {},
): { saved: boolean; workflow: unknown; problems: Problem[]; version?: string } {
  const file = workflowFile(root, given);
  if (!file) throw noWorkflow();
  // a change made to the file elsewhere (an editor, another tab, an agent) is never saved over unasked
  const now = versionOf(readFileSync(file, "utf8"));
  if (from.base !== undefined && from.base !== now && !from.over) throw new Changed(now);
  const problems = parseWorkflow(workflow).problems;
  if (workflow.name !== given) {
    problems.push({
      path: "name",
      message: `The workflow's name is "${String(workflow.name)}", but its file is ${given}.json.`,
      fix: `Set "name" to "${given}".`,
    });
  }
  if (problems.length > 0) return { saved: false, workflow, problems, version: now };
  const text = `${JSON.stringify(workflow, null, 2)}\n`;
  // written beside and moved into place: never through a link, and never left half written
  const beside = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(beside, text, { flag: "wx" });
    renameSync(beside, file);
  } catch (error) {
    rmSync(beside, { force: true }); // or the next save would find it in its way
    throw new Error(`The workflow could not be written: ${(error as Error).message}`);
  }
  return { saved: true, workflow, problems: [], version: versionOf(text) };
}
