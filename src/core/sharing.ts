// `softwarefactor export` and `softwarefactor import`: a workflow leaves one workspace as one JSON
// document and arrives in another. The document holds the workflow, with its prompts inside it,
// and the pins of the plugins it lists. It holds nothing of the machine it came from. An import
// shows what the workflow would run, writes it only on a yes, and puts a person back in front of
// every lane: the record that let a lane run unwatched belongs to the other machine.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { readAccounts } from "./accounts.ts";
import { UserError } from "./errors.ts";
import { GIT_SOURCE } from "./plugins/install.ts";
import { commandsOf, isPlainCommand } from "./plugins/manifest.ts";
import { type Lock, LockFile, lockPath, readLock } from "./plugins/use.ts";
import { own } from "./schema/builtins.ts";
import { parseWorkflow } from "./schema/parse.ts";
import type { Workflow } from "./schema/workflow.ts";
import { oneLine } from "./text.ts";
import { factorHome, type Workspace } from "./workspace.ts";

type Say = (line: string) => void;
type Json = Record<string, unknown>;
/** What both commands need of a workspace. Its workflow is not read: an import is how a broken one is replaced. */
type Place = Pick<Workspace, "root" | "factorDir" | "config">;
const NAME = /^[a-z][a-z0-9-]*$/;
const MOST_BYTES = 2_000_000;

/** Whether a path is a plain file that really is inside a folder: no link at it, none on the way to it. */
function plainFileIn(folder: string, path: string): boolean {
  try {
    return lstatSync(path).isFile() && `${realpathSync(path)}`.startsWith(`${realpathSync(folder)}/`);
  } catch {
    return false; // not there
  }
}

const Export = z.strictObject({
  softwarefactorExport: z.literal(1),
  workflow: z.record(z.string(), z.unknown()),
  // the pins of the plugins the workflow lists: what `softwarefactor add` installs on the other machine
  plugins: LockFile.optional(),
});

const problemsOf = (workflow: unknown, what: string): Workflow => {
  const checked = parseWorkflow(workflow);
  if (checked.workflow) return checked.workflow;
  const list = checked.problems.slice(0, 5).map((p) => `  ${p.path}: ${p.message}`);
  throw new UserError(
    `${what} has problems:\n${list.join("\n")}`,
    checked.problems[0]?.fix ?? "Fix them first.",
  );
};

/** Every string in a value, keys included, with where it is. */
function strings(value: unknown, path = ""): { path: string; text: string }[] {
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => {
      const at = path ? `${path}.${k}` : k;
      return [{ path: at, text: k }, ...strings(v, at)];
    });
  }
  return [];
}

/** Whether a text holds a path as a path: not as part of a longer name or a longer path. */
const holdsPath = (text: string, path: string) => {
  for (let at = text.indexOf(path); at >= 0; at = text.indexOf(path, at + 1)) {
    const before = text[at - 1] ?? "";
    const after = text[at + path.length] ?? "";
    if (!/[A-Za-z0-9_.-]/.test(before) && !/[A-Za-z0-9_.-]/.test(after)) return true;
  }
  return false;
};

/** `softwarefactor export [workflow] [--out <file>]`. */
export function exportCommand(ws: Place, args: string[], flags: { out?: string }, say: Say): number {
  const name = args[0] ?? ws.config.workflow;
  const folder = join(ws.factorDir, "workflows");
  const file = join(folder, `${name}.json`);
  if (!NAME.test(name) || !plainFileIn(folder, file)) {
    throw new UserError(
      `This workspace has no workflow "${name}".`,
      "Name one of the files in .factor/workflows/, without .json.",
    );
  }
  let workflow: Json;
  try {
    workflow = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new UserError(`${file} is not JSON: ${(error as Error).message}`, "Fix the file.");
  }
  const checked = problemsOf(workflow, `The workflow "${name}"`);
  // a prompt kept in a file beside the workflow goes into the document: one file travels, not a folder
  const inline = (holder: { prompt?: unknown } | undefined, where: string) => {
    const prompt = holder?.prompt;
    if (typeof prompt !== "object" || prompt === null) return;
    const from = join(folder, String((prompt as { file?: unknown }).file));
    // through no link: a link beside the workflow could carry any file of the person's into the export
    if (!plainFileIn(folder, from)) {
      throw new UserError(
        `${where} names a prompt file that is not a plain file in .factor/workflows/.`,
        `Write ${from} as a file of its own (not a link, not a folder).`,
      );
    }
    (holder as { prompt: unknown }).prompt = readFileSync(from, "utf8");
  };
  for (const [i, lane] of ((workflow.lanes as Json[]) ?? []).entries()) {
    inline(lane.agent as { prompt?: unknown } | undefined, `lanes[${i}].agent`);
    const members = ((lane.panel as { members?: unknown[] } | undefined)?.members ?? []) as {
      prompt?: unknown;
    }[];
    for (const [m, member] of members.entries()) inline(member, `lanes[${i}].panel.members[${m}]`);
  }
  problemsOf(workflow, `The workflow "${name}", with its prompts read in,`); // a secret in a prompt file is found here

  // Nothing of this machine: a role is not an account, and no text names a folder of this machine.
  const accounts = readAccounts();
  for (const role of Object.keys(checked.roles)) {
    if (own(accounts, role)) {
      throw new UserError(
        `The role "${role}" has the name of an account on this machine.`,
        "A shared workflow names roles, never accounts: give the role a name for what it does.",
      );
    }
  }
  // this machine's folders, each also by its real path (a link's two names are both this machine's)
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const here = [...new Set([homedir(), ws.root, factorHome()].flatMap((p) => [p, real(p)]))].filter(
    (p) => p.length > 1,
  );
  const leak = strings(workflow).find((s) => here.some((p) => holdsPath(s.text, p)));
  if (leak) {
    throw new UserError(
      `${leak.path} holds the path of a folder on this machine.`,
      "Take the path out: the other machine does not have it.",
    );
  }
  const lock = readLock(ws);
  const plugins: Lock = {};
  for (const plugin of Object.keys(checked.plugins ?? {})) {
    const pinned = own(lock, plugin);
    if (!pinned) {
      throw new UserError(
        `The plugin "${plugin}" is not installed in this workspace, so it cannot be pinned.`,
        `Add it first: softwarefactor add ${plugin}`,
      );
    }
    if (!GIT_SOURCE.test(pinned.source)) {
      throw new UserError(
        `The plugin "${plugin}" was added from a folder on this machine (${pinned.source}).`,
        "Add it from a repository (owner/repo), so that the other machine can fetch the same.",
      );
    }
    if (!pinned.commit) {
      throw new UserError(
        `The pin of the plugin "${plugin}" names no commit.`,
        `Add it again: softwarefactor add ${pinned.source}`,
      );
    }
    plugins[plugin] = pinned;
  }
  const doc = { softwarefactorExport: 1, workflow, ...(Object.keys(plugins).length > 0 ? { plugins } : {}) };
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  if (flags.out === undefined) process.stdout.write(text);
  else {
    try {
      writeFileSync(flags.out, text, { flag: "wx" }); // never over a file that is there
    } catch (error) {
      const there = (error as NodeJS.ErrnoException).code === "EEXIST";
      throw new UserError(
        there
          ? `${flags.out} is already there.`
          : `${flags.out} could not be written: ${(error as Error).message}`,
        "Name a file that does not exist yet.",
      );
    }
    say(`exported ${name} to ${flags.out}`);
  }
  return 0;
}

/** Read an export: its shape, then its workflow through the checker. Throws, saying why, for anything else. */
export function readExport(text: string, from: string): { workflow: Workflow; raw: Json; plugins: Lock } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new UserError(
      `${from} is not JSON: ${(error as Error).message}`,
      "An export is the file `softwarefactor export` wrote.",
    );
  }
  const parsed = Export.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const keys = issue?.code === "unrecognized_keys" ? ` (${issue.keys.join(", ")})` : "";
    throw new UserError(
      `${from} is not an export this version reads, at ${issue?.path.join(".") || "the top"}${keys}.`,
      "An export is the file `softwarefactor export` wrote: softwarefactorExport 1, a workflow, and the pins of its plugins.",
    );
  }
  const workflow = problemsOf(parsed.data.workflow, `The workflow in ${from}`);
  // A pin decides what `softwarefactor add` fetches here. It is taken only for a plugin the
  // workflow lists, from a repository, at a commit: never a folder, never a plugin by the way.
  for (const [name, pin] of Object.entries(parsed.data.plugins ?? {})) {
    const why = !own(workflow.plugins, name)
      ? "the workflow does not list that plugin"
      : !GIT_SOURCE.test(pin.source)
        ? "its source is not a repository"
        : pin.commit === undefined
          ? "it names no commit"
          : undefined;
    if (why) {
      throw new UserError(
        `${from} is not an export this version reads, at plugins.${name}: ${why}.`,
        "Export the workflow again.",
      );
    }
  }
  const inFile = workflow.lanes.find(
    (lane) =>
      typeof lane.agent?.prompt === "object" ||
      (lane.panel?.members ?? []).some(
        (member) => typeof (member as { prompt?: unknown }).prompt === "object",
      ),
  );
  if (inFile) {
    throw new UserError(
      `The workflow in ${from} keeps the prompt of lane "${inFile.id}" in a file it did not bring.`,
      "Export it again: an export holds its prompts.",
    );
  }
  return { workflow, raw: parsed.data.workflow, plugins: parsed.data.plugins ?? {} };
}

/** `softwarefactor import <file> [--yes] [--use] [--keep-checkpoints]`. */
export function importCommand(
  ws: Place,
  args: string[],
  flags: { yes?: boolean; use?: boolean; "keep-checkpoints"?: boolean; hash?: string },
  say: Say,
): number {
  const file = args[0];
  if (!file) throw new UserError("Name the export to import.", "softwarefactor import <file>");
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new UserError(`There is no file ${file}.`, "Name the file `softwarefactor export` wrote.");
  }
  if (statSync(file).size > MOST_BYTES) {
    throw new UserError(`${file} is over 2 MB.`, "An export is a workflow, not data.");
  }
  const text = readFileSync(file, "utf8");
  const hash = createHash("sha256").update(text).digest("hex");
  const { workflow, raw, plugins } = readExport(text, file);
  const to = join(ws.factorDir, "workflows", `${workflow.name}.json`);
  if (existsSync(to)) {
    throw new UserError(
      `A workflow named "${workflow.name}" is already in this workspace.`,
      `Move .factor/workflows/${workflow.name}.json out of the way first: an import never writes over a workflow.`,
    );
  }
  const lock = readLock(ws);
  for (const [name, pin] of Object.entries(plugins)) {
    const have = own(lock, name);
    if (have && have.sha256 !== pin.sha256) {
      throw new UserError(
        `This workspace already pins another version of the plugin "${name}" (${have.version} from ${have.source}).`,
        "An import never changes a pin. Decide which version this workspace uses, then import again.",
      );
    }
  }
  const unwatched = workflow.lanes.filter((l) => l.checkpoint !== "in").map((l) => l.id);
  const waits = flags["keep-checkpoints"] ? [] : unwatched;

  // every text of the document is shown on one line: none can add a line of its own to this listing
  say(`${workflow.name}: ${oneLine(workflow.description, 300)}`);
  say("Lanes:");
  for (const lane of workflow.lanes) {
    const what = lane.agent
      ? `agent, role ${lane.agent.role}, ${lane.agent.access === "write" ? "can change files" : "reads only"}`
      : lane.uses;
    say(
      `  ${lane.id} (${what}), checkpoint ${lane.checkpoint}${waits.includes(lane.id) ? " -> in" : ""}${lane.pin ? ", pinned" : ""}`,
    );
  }
  say("Tasks come from:");
  for (const c of workflow.collectors)
    say(`  ${c.id}: ${c.uses}${c.with ? ` ${JSON.stringify(c.with)}` : ""}`);
  const prompts = workflow.lanes
    .flatMap((lane) => [
      lane.agent?.prompt,
      ...(lane.panel?.members ?? []).map((m) => (m as { prompt?: unknown }).prompt),
    ])
    .filter((p) => typeof p === "string").length;
  say(
    `It holds ${prompts} prompt${prompts === 1 ? "" : "s"} for agents: read ${prompts === 1 ? "it" : "them"} in ${file} before you run it.`,
  );
  const commands = commandsOf(raw);
  if (commands.length > 0) {
    say("It would run these on this machine, with your rights:");
    for (const command of commands) say(`  ${isPlainCommand(command) ? command : JSON.stringify(command)}`);
  }
  say("Before it can run here:");
  for (const [role, r] of Object.entries(workflow.roles)) {
    say(`  role ${role}: ${oneLine(r.description, 300)}`);
    say(`      bind it: softwarefactor role bind ${role} --account <name>`);
  }
  for (const [name, c] of Object.entries(workflow.commands ?? {})) {
    say(`  command ${name}: ${oneLine(c.description, 300)}`);
    // the workflow only names it: what it runs is this workspace's own, and a gate runs it unasked
    const here = own(ws.config.commands, name);
    say(
      here
        ? `      already defined here, and runs: ${oneLine(here, 300)}`
        : `      define it under "commands" in .factor/factory.json`,
    );
  }
  for (const [name, range] of Object.entries(workflow.plugins ?? {})) {
    const pin = own(plugins, name);
    say(
      `  plugin ${name} ${pin ? `${pin.version} from ${pin.source}, commit ${pin.commit?.slice(0, 12)}, sha256 ${pin.sha256}` : `${oneLine(range, 60)} (the export does not pin it)`}`,
    );
    say(`      see and install it: softwarefactor add${pin ? "" : ` <source of ${name}>`}`);
  }
  for (const [name, server] of Object.entries(workflow.mcp ?? {})) {
    if (server.from === "command")
      say(`  MCP server ${name}, started by a command\n      see and allow it: softwarefactor allow ${name}`);
  }
  for (const [name, skill] of Object.entries(workflow.skills ?? {})) {
    if (skill.from !== "repo") continue;
    say(
      `  skill ${name}: ${oneLine(skill.source, 200)}${skill.skill ? `, ${oneLine(skill.skill, 100)}` : ""}`,
    );
    say(`      see and allow it: softwarefactor allow --skill ${name}`);
  }
  if (waits.length > 0) {
    say(
      `These lanes will wait for a person here (they did not where the workflow came from): ${waits.join(", ")}.`,
    );
    say(
      "  The record that let them run unwatched belongs to the other machine. --keep-checkpoints leaves them as they are.",
    );
  }
  if (waits.length === 0 && unwatched.length > 0) {
    say(
      `These lanes will run without a person here, as they did where the workflow came from: ${unwatched.join(", ")}.`,
    );
  }
  say("A gate's command runs before anyone is asked, also for a lane that waits: read the commands above.");
  // the pin is the whole file: what is written is what this listing was about
  if (flags.hash !== undefined && flags.hash !== hash) {
    throw new UserError(
      `${file} is not the file that was shown for --hash ${flags.hash.slice(0, 80)}: it has changed.`,
      "Read the listing above, and use the command it prints.",
    );
  }
  if (!flags.yes) {
    const options = `${flags.use ? " --use" : ""}${flags["keep-checkpoints"] ? " --keep-checkpoints" : ""}`;
    say(`Nothing was written. To import it: softwarefactor import ${file} --yes --hash ${hash}${options}`);
    return 0;
  }

  // the pins first, then the workflow: a failure half way leaves no workflow without its pins
  let pinned = false;
  for (const [name, pin] of Object.entries(plugins)) {
    if (own(lock, name)) continue; // the same pin is already here
    lock[name] = pin;
    pinned = true;
  }
  if (pinned) {
    const sorted = Object.fromEntries(Object.entries(lock).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    writeFileSync(lockPath(ws), `${JSON.stringify(sorted, null, 2)}\n`);
  }
  const lanes = (raw.lanes as Json[]).map((lane) =>
    waits.includes(String(lane.id)) ? { ...lane, checkpoint: "in" } : lane,
  );
  // into a name nothing has: never over a file, and never through a link that is waiting there
  try {
    writeFileSync(to, `${JSON.stringify({ ...raw, lanes }, null, 2)}\n`, { flag: "wx" });
  } catch {
    throw new UserError(
      `Something is already at .factor/workflows/${workflow.name}.json.`,
      "Move it out of the way first.",
    );
  }
  say(`imported ${workflow.name} to .factor/workflows/${workflow.name}.json`);
  if (flags.use) {
    const factory = join(ws.factorDir, "factory.json");
    writeFileSync(
      factory,
      `${JSON.stringify({ ...JSON.parse(readFileSync(factory, "utf8")), workflow: workflow.name }, null, 2)}\n`,
    );
    say(`this workspace now runs "${workflow.name}"`);
  } else
    say(`To run it here, set "workflow": "${workflow.name}" in .factor/factory.json, or import with --use.`);
  return 0;
}
