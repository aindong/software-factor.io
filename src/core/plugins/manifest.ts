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

export const MANIFEST = "factor-plugin.json";
const MOST_FILES = 500;
const MOST_BYTES = 5_000_000;

const typeKey = z.string().regex(/^[a-z][a-z0-9-]*@[1-9][0-9]*$/, {
  message: 'Name a type as "<name>@<major version>", such as "board@1".',
});
const Type = z.strictObject({
  description: z.string().min(1),
  // a shell command line, run like a command lane's. The plugin's folder is in FACTOR_PLUGIN_DIR.
  run: z.string().min(1),
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
  description: z.string().min(1),
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
  /** Its files, relative to the folder, sorted. */
  files: string[];
  /** The workflows it brings, by their own names. */
  workflows: { name: string; file: string; commands: string[] }[];
}

/** Every plain file under a folder, sorted. A link is refused: it could lead anywhere. */
function filesIn(dir: string, under = ""): string[] {
  return readdirSync(join(dir, under))
    .sort()
    .flatMap((name) => {
      const rel = under ? `${under}/${name}` : name;
      const stat = lstatSync(join(dir, rel));
      if (stat.isSymbolicLink())
        throw new UserError(`The plugin holds a link (${rel}).`, "A plugin is plain files only.");
      if (stat.isDirectory()) return name === ".git" && !under ? [] : filesIn(dir, rel);
      if (!stat.isFile())
        throw new UserError(
          `The plugin holds something that is no file (${rel}).`,
          "A plugin is plain files only.",
        );
      return [rel];
    });
}

/** Every command line a workflow would run on the host: its lanes', its gates', its waits', its MCP servers'. */
function commandsOf(workflow: Record<string, unknown>): string[] {
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

/** Read a plugin folder: its manifest, its files and their hash. Refuses what is not a plugin, saying why. */
export function readPlugin(dir: string): Plugin {
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
  const files = filesIn(dir);
  if (files.length > MOST_FILES)
    throw new UserError(`The plugin holds ${files.length} files.`, `A plugin holds at most ${MOST_FILES}.`);
  const hash = createHash("sha256");
  let bytes = 0;
  for (const file of files) {
    const content = readFileSync(join(dir, file));
    bytes += content.length;
    if (bytes > MOST_BYTES)
      throw new UserError("The plugin is over 5 MB.", "A plugin is commands and workflows, not data.");
    hash.update(`${file}\0${content.length}\0`).update(content);
  }
  const workflows = (parsed.data.workflows ?? []).map((file) => {
    if (!files.includes(file))
      throw new UserError(
        `The plugin names a workflow that is not in it: ${file}`,
        'Fix the manifest\'s "workflows".',
      );
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
