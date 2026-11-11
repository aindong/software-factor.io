// A workspace is one repository with a `.factor/` folder. This finds it and reads its files.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { z } from "zod";
import { FactoryConfig, LocalConfig } from "./config.ts";
import { UserError } from "./errors.ts";
import { repoRoot } from "./git.ts";
import { parseWorkflow } from "./schema/parse.ts";
import type { Workflow } from "./schema/workflow.ts";

export interface Workspace {
  root: string;
  /** Stable name for this workspace's folders under the machine's factor home. */
  id: string;
  factorDir: string;
  dbPath: string;
  runsDir: string;
  /** Where worktrees live, outside the repository. */
  workDir: string;
  config: FactoryConfig;
  local: LocalConfig;
  workflow: Workflow;
  /** The workflow's file as it was read: what a run is kept with, whatever the file becomes while the process runs. */
  workflowText: string;
  /** Each agent lane's instructions, read once when the workspace loads. */
  prompts: Record<string, string>;
}

/** The machine's own folder for accounts and worktrees. Tests point FACTOR_HOME somewhere private. */
export function factorHome(): string {
  const set = process.env.FACTOR_HOME;
  // always absolute: a relative path would put worktrees inside the repository
  return resolve(set && set.trim() !== "" ? set : join(homedir(), ".factor"));
}

export function workspaceId(root: string): string {
  return `${basename(root)}-${createHash("sha256").update(root).digest("hex").slice(0, 8)}`;
}

function readJson<T>(path: string, schema: z.ZodType<T>, what: string): T {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new UserError(
      `Cannot read ${what} at ${path}: ${(error as Error).message}`,
      "Fix the JSON, or delete the file and run `softwarefactor init`.",
    );
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new UserError(
      `${what} is not valid at "${first?.path.join(".") || "(top)"}": ${first?.message}`,
      `Edit ${path}.`,
    );
  }
  return parsed.data;
}

/** Where the factory is and how it is set up, without reading its workflow: for commands that must work when the workflow is broken or missing. */
export function locateWorkspace(cwd: string): Pick<Workspace, "root" | "factorDir" | "config"> {
  const root = repoRoot(cwd);
  const factorDir = join(root, ".factor");
  const configPath = join(factorDir, "factory.json");
  if (!existsSync(configPath)) {
    throw new UserError("This repository has no factory yet.", "Run `softwarefactor init`.");
  }
  const config = readJson(configPath, FactoryConfig, "factory.json");
  const here = localWorkflow(factorDir);
  return { root, factorDir, config: here ? { ...config, workflow: here } : config };
}

/** The workflow local.json names for this machine, when it names one. */
function localWorkflow(factorDir: string): string | undefined {
  try {
    const name = JSON.parse(readFileSync(join(factorDir, "local.json"), "utf8")).workflow;
    return typeof name === "string" && /^[a-z][a-z0-9-]*$/.test(name) ? name : undefined;
  } catch {
    return undefined;
  }
}

/** The name of the workflow in use here, for a page or a listing. Empty when the setup cannot be read. */
export function workflowHere(root: string): string {
  const factorDir = join(root, ".factor");
  try {
    const shared = JSON.parse(readFileSync(join(factorDir, "factory.json"), "utf8")).workflow;
    return localWorkflow(factorDir) ?? String(shared ?? "");
  } catch {
    return "";
  }
}

export function loadWorkspace(cwd: string): Workspace {
  const { root, factorDir, config } = locateWorkspace(cwd);
  const localPath = join(factorDir, "local.json");
  const local = existsSync(localPath) ? readJson(localPath, LocalConfig, "local.json") : { roles: {} };

  const workflowPath = join(factorDir, "workflows", `${config.workflow}.json`);
  let workflowJson: unknown;
  let workflowText = "";
  try {
    workflowText = readFileSync(workflowPath, "utf8");
    workflowJson = JSON.parse(workflowText);
  } catch (error) {
    throw new UserError(
      `Cannot read the workflow at ${workflowPath}: ${(error as Error).message}`,
      `Check "workflow" in .factor/${local.workflow ? "local" : "factory"}.json.`,
    );
  }
  const { workflow, problems } = parseWorkflow(workflowJson);
  if (!workflow) {
    const list = problems.map((p) => `  ${p.path}: ${p.message}\n    fix: ${p.fix}`).join("\n");
    throw new UserError(`The workflow "${config.workflow}" has problems:\n${list}`, `Edit ${workflowPath}.`);
  }
  const prompts: Record<string, string> = {};
  // a lane's instructions, and each panel member's own part as "<lane>.<member>"
  const texts = workflow.lanes.flatMap((lane) => [
    { id: lane.id, lane: lane.id, p: lane.agent?.prompt },
    ...(lane.panel?.members ?? []).map((m) => ({ id: `${lane.id}.${m.id}`, lane: lane.id, p: m.prompt })),
  ]);
  for (const { id: promptId, lane: laneId, p } of texts) {
    const lane = { id: laneId };
    if (p === undefined) continue;
    if (typeof p === "string") prompts[promptId] = p;
    else {
      const file = join(factorDir, "workflows", p.file);
      if (!existsSync(file)) {
        throw new UserError(
          `Lane "${lane.id}" names the prompt file ${p.file}, which does not exist.`,
          `Create ${file}, or write the prompt inline.`,
        );
      }
      // a plain file of the workflows folder: a link there could put any file of the person's before an agent
      const real = lstatSync(file).isFile() ? realpathSync(file) : "";
      if (!real.startsWith(`${realpathSync(join(factorDir, "workflows"))}/`)) {
        throw new UserError(
          `Lane "${lane.id}" names the prompt file ${p.file}, which is not a plain file in .factor/workflows/.`,
          `Write ${file} as a file of its own (not a link, not a folder), or write the prompt inline.`,
        );
      }
      prompts[promptId] = readFileSync(file, "utf8");
    }
  }
  const id = workspaceId(root);
  return {
    root,
    id,
    factorDir,
    dbPath: join(factorDir, "state.db"),
    runsDir: join(factorDir, "runs"),
    workDir: join(factorHome(), "work", id),
    config,
    local,
    workflow,
    workflowText,
    prompts,
  };
}
