// A plugin is a folder with a `factor-plugin.json`. It adds collectors, gates and lane types (each
// a command line), and workflows. Its code is someone else's: the factory only ever runs the
// commands the manifest names, and knows the folder by the hash of every file in it.
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { UserError } from "../errors.ts";
import { insidePath } from "../schema/builtins.ts";
import { parseWorkflow } from "../schema/parse.ts";
import { showsAsIs } from "../text.ts";

export const MANIFEST = "factor-plugin.json";
const MOST_FILES = 500;
const MOST_BYTES = 5_000_000;
// left out of a plugin wherever they are: they are the machine's, not the plugin's
const NOT_ITS_OWN = new Set([".git", ".DS_Store"]);

const typeKey = z.string().regex(/^[a-z][a-z0-9-]*@[1-9][0-9]*$/, {
  message: 'Name a type as "<name>@<major version>", such as "board@1".',
});
// What is shown must be what runs: no line break (a second, forged line of the summary), no
// escape, and no character that reorders or hides text.
const line = z.string().min(1).refine(showsAsIs, { message: "Keep it to one line of plain characters." });
/** A command that is shown exactly as it runs: visible ASCII, one line, no long run of spaces to push its end out of sight. */
export const isPlainCommand = (text: string) => /^[\x20-\x7e]{1,500}$/.test(text) && !/ {10}/.test(text);
const command = z.string().refine(isPlainCommand, {
  message:
    "Write the command as one line of plain ASCII, at most 500 characters, with no long run of spaces.",
});
const Type = z.strictObject({
  description: line,
  // a shell command line, run like a command lane's. The plugin's folder is in FACTOR_PLUGIN_DIR.
  run: command,
});
export const Manifest = z.strictObject({
  name: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, {
      message: "Use lowercase letters, digits and dashes, starting with a letter.",
    })
    .refine((name) => name !== "core", { message: 'The name "core" is the factory\'s own.' }),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, { message: 'Write the version as three numbers, such as "1.2.0".' }),
  description: line,
  collectors: z.record(typeKey, Type).optional(),
  gates: z.record(typeKey, Type).optional(),
  lanes: z.record(typeKey, Type).optional(),
  workflows: z.array(insidePath).optional(),
});
export type Manifest = z.infer<typeof Manifest>;

export interface Plugin {
  dir: string;
  manifest: Manifest;
  /** The sha256 of every file's path and content: what was shown is what this names. */
  hash: string;
  /** Its files, relative to the folder, in the order they are hashed. */
  files: string[];
  /** The workflows it brings, by their own names. */
  workflows: { name: string; file: string; commands: string[] }[];
}

/** Every plain file under a folder, each folder's names in order. A link is refused: it could lead anywhere. It stops once there are too many. */
function filesIn(dir: string, skip: boolean, under = "", found: string[] = []): string[] {
  for (const name of readdirSync(join(dir, under)).sort()) {
    if (skip && NOT_ITS_OWN.has(name)) continue;
    const rel = under ? `${under}/${name}` : name;
    const stat = lstatSync(join(dir, rel));
    if (stat.isSymbolicLink())
      throw new UserError(`The plugin holds a link (${rel}).`, "A plugin is plain files only.");
    if (stat.isDirectory()) filesIn(dir, skip, rel, found);
    else if (stat.isFile()) found.push(rel);
    else
      throw new UserError(
        `The plugin holds something that is no file (${rel}).`,
        "A plugin is plain files only.",
      );
    if (found.length > MOST_FILES) {
      throw new UserError(
        `The plugin holds more than ${MOST_FILES} files.`,
        "A plugin is commands and workflows, not data.",
      );
    }
  }
  return found;
}

/** Every command line a workflow would run on the host: its lanes', its gates', its waits', its MCP servers'. */
export function commandsOf(workflow: Record<string, unknown>): string[] {
  const found: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value !== "object" || value === null) return;
    if (Array.isArray(value)) return value.forEach(walk);
    const o = value as Record<string, unknown>;
    if (typeof o.run === "string") found.push(o.run);
    if (o.from === "command" && typeof o.command === "string")
      found.push(JSON.stringify([o.command, ...(Array.isArray(o.args) ? o.args : [])]));
    Object.values(o).forEach(walk);
  };
  walk(workflow);
  return found;
}

/**
 * Read a plugin folder: its manifest, its files and their hash. Refuses what is not a plugin, saying why.
 * `from` says what the folder is. A source may hold a `.git` or a `.DS_Store`, which are left
 * out. An installed copy never does, so there every file counts: one planted where a source's
 * would be skipped changes the hash like any other.
 */
export function readPlugin(dir: string, from: "source" | "installed" = "source"): Plugin {
  let text: string;
  try {
    if (!lstatSync(join(dir, MANIFEST)).isFile()) throw new Error("not a file");
    text = readFileSync(join(dir, MANIFEST), "utf8");
  } catch {
    throw new UserError(
      `There is no ${MANIFEST} in ${dir}.`,
      `A plugin is a folder with a ${MANIFEST} in it.`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new UserError(`${MANIFEST} is not JSON: ${(error as Error).message}`, "Fix the file.");
  }
  const parsed = Manifest.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") || "the manifest";
    const keys = issue?.code === "unrecognized_keys" ? ` (${issue.keys.join(", ")})` : "";
    throw new UserError(
      `${MANIFEST} is not valid at ${where}${keys}: ${issue?.message}`,
      "See docs/plugins.md for what a manifest holds.",
    );
  }
  const files = filesIn(dir, from === "source");
  const hash = createHash("sha256");
  let bytes = 0;
  for (const file of files) {
    bytes += lstatSync(join(dir, file)).size; // before the file is read
    if (bytes > MOST_BYTES)
      throw new UserError("The plugin is over 5 MB.", "A plugin is commands and workflows, not data.");
    const content = readFileSync(join(dir, file));
    hash.update(`${file}\0${content.length}\0`).update(content);
  }
  const workflows = (parsed.data.workflows ?? []).map((file) => {
    if (!files.includes(file)) {
      throw new UserError(
        `The plugin names a workflow that is not in it: ${file}`,
        'Fix the manifest\'s "workflows".',
      );
    }
    let workflow: unknown;
    try {
      workflow = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch {
      workflow = undefined;
    }
    const checked = parseWorkflow(workflow);
    if (!checked.workflow) {
      const first = checked.problems[0];
      throw new UserError(
        `The plugin's workflow ${file} does not pass the checker${first ? `: ${first.path}: ${first.message}` : ""}.`,
        "A workflow a plugin brings must be valid as it is.",
      );
    }
    // only the workflow's own file is copied into the workspace: it must hold everything it needs
    const inFile = checked.workflow.lanes.find(
      (lane) =>
        typeof lane.agent?.prompt === "object" ||
        (lane.panel?.members ?? []).some(
          (member) => typeof (member as { prompt?: unknown }).prompt === "object",
        ),
    );
    if (inFile) {
      throw new UserError(
        `The plugin's workflow ${checked.workflow.name} keeps the prompt of lane "${inFile.id}" in a file beside it.`,
        "A workflow a plugin brings holds its prompts in the workflow file itself.",
      );
    }
    return { name: checked.workflow.name, file, commands: commandsOf(workflow as Record<string, unknown>) };
  });
  return { dir, manifest: parsed.data, hash: hash.digest("hex"), files, workflows };
}

/** What a plugin adds, by the names a workflow uses. */
export function addsOf(p: Plugin): string[] {
  const names = (kind: "collectors" | "gates" | "lanes") =>
    Object.keys(p.manifest[kind] ?? {}).map((t) => `${p.manifest.name}/${t}`);
  return [
    ...names("collectors"),
    ...names("gates"),
    ...names("lanes"),
    ...p.workflows.map((w) => `workflow ${w.name}`),
  ];
}
