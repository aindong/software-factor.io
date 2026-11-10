// `softwarefactor add`: fetch a plugin, show what it holds and would run, and install it on a yes.
// A source is a folder, a git repository (`owner/repo`, with a folder and a ref if wanted), or a
// name the directory index knows. Nothing of the plugin is run here: it is only read and copied.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { UserError } from "../errors.ts";
import { own } from "../schema/builtins.ts";
import { oneLine } from "../text.ts";
import type { Workspace } from "../workspace.ts";
import { addsOf, type Plugin, readPlugin } from "./manifest.ts";
import { installDir, type Lock, type LockEntry, lockPath, readLock } from "./use.ts";

type Say = (line: string) => void;
const DIRECTORY = "https://raw.githubusercontent.com/aindong/software-factor.io/main/directory/index.json";
// one part of a git source: no part may begin with a dash (an option to git) or be a step upwards
const PART = "(?!-)(?!\\.\\.?(?:/|#|$))[A-Za-z0-9_.-]+";
const GIT_SOURCE = new RegExp(`^(${PART})/(${PART})((?:/${PART})*)(?:#((?!-)[A-Za-z0-9_./-]+))?$`);

const Index = z.object({
  version: z.literal(1),
  plugins: z.array(z.object({ name: z.string().min(1), description: z.string(), source: z.string().min(1) })),
});
export type Index = z.infer<typeof Index>;
export const directoryAddress = () => process.env.FACTOR_DIRECTORY || DIRECTORY;

/** The directory: a static JSON file, read from an address or from a file. */
export async function readDirectory(): Promise<Index> {
  const address = directoryAddress();
  let text: string;
  try {
    if (/^https?:\/\//.test(address)) {
      const answer = await fetch(address);
      if (!answer.ok) throw new Error(`the server answered ${answer.status}`);
      text = await answer.text();
    } else text = readFileSync(address, "utf8");
  } catch (error) {
    throw new UserError(
      `The plugin index could not be read (${address}): ${(error as Error).message}`,
      "Check the address, or name a folder or owner/repo instead.",
    );
  }
  let index: unknown;
  try {
    index = JSON.parse(text);
  } catch {
    index = undefined;
  }
  const parsed = Index.safeParse(index);
  if (!parsed.success)
    throw new UserError(
      `The plugin index at ${address} is not an index.`,
      'An index is { "version": 1, "plugins": [{ "name", "description", "source" }] }.',
    );
  return parsed.data;
}

interface Fetched {
  plugin: Plugin;
  /** What the person named. It goes into the lock, so another machine can fetch the same. */
  source: string;
  /** Where it was read from, in full. */
  from: string;
  commit?: string;
  /** A folder to remove when done. */
  temp?: string;
}

/** Read a plugin from its source. `commit` asks for that commit of a git source, not the tip. */
async function fetchPlugin(source: string, cwd: string, commit?: string): Promise<Fetched> {
  if (/^[./~]/.test(source) || isAbsolute(source)) {
    const dir = resolve(cwd, source.replace(/^~(?=\/|$)/, process.env.HOME ?? "~"));
    return { plugin: readPlugin(dir), source, from: `the folder ${dir}` };
  }
  if (/^[a-z][a-z0-9-]*$/.test(source)) {
    const entry = (await readDirectory()).plugins.find((p) => p.name === source);
    if (!entry) {
      throw new UserError(
        `The index has no plugin "${source}" (${directoryAddress()}).`,
        "See what it has with `softwarefactor plugins --available`, or name a folder or owner/repo.",
      );
    }
    if (/^[a-z][a-z0-9-]*$/.test(entry.source))
      throw new UserError(
        `The index entry "${source}" names no source.`,
        "An entry's source is a folder or owner/repo.",
      );
    const fetched = await fetchPlugin(entry.source, cwd, commit);
    if (fetched.plugin.manifest.name !== source) {
      if (fetched.temp) rmSync(fetched.temp, { recursive: true, force: true });
      throw new UserError(
        `The index entry "${source}" leads to a plugin named "${fetched.plugin.manifest.name}".`,
        "Tell the keeper of the index.",
      );
    }
    return { ...fetched, source: entry.source };
  }
  const m = GIT_SOURCE.exec(source);
  if (!m)
    throw new UserError(
      `"${source}" is not a plugin source.`,
      "Name a folder (./plugin), a repository (owner/repo, owner/repo/folder, owner/repo#ref) or a name from the index.",
    );
  const [, owner = "", repo = "", sub = "", ref] = m;
  const address = `${process.env.FACTOR_GIT_BASE || "https://github.com/"}${owner}/${repo}.git`;
  const temp = mkdtempSync(join(tmpdir(), "sf-plugin-"));
  const git = (...args: string[]) =>
    spawnSync("git", args, {
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  const failed = (what: string, r: { stderr: string; error?: Error }) => {
    rmSync(temp, { recursive: true, force: true });
    return new UserError(
      `Could not ${what} ${owner}/${repo}${ref ? `#${ref}` : ""}: ${oneLine(r.stderr || r.error?.message || "git failed", 300)}`,
      "Check the name and the ref, and that you can read the repository.",
    );
  };
  // no hooks run on a clone, and links in it are refused when the plugin is read
  const cloned = git(
    "clone",
    "-q",
    "--depth",
    "1",
    "--no-tags",
    ...(ref ? ["--branch", ref] : []),
    "--",
    address,
    temp,
  );
  if (cloned.status !== 0) throw failed("fetch", cloned);
  if (commit) {
    const at = git("-C", temp, "rev-parse", "HEAD").stdout.trim();
    if (at !== commit) {
      const got = git("-C", temp, "fetch", "-q", "--depth", "1", "origin", commit);
      const out = got.status === 0 ? git("-C", temp, "checkout", "-q", "--detach", "FETCH_HEAD") : got;
      if (out.status !== 0) throw failed(`fetch the commit ${commit.slice(0, 12)} of`, out);
    }
  }
  const head = git("-C", temp, "rev-parse", "HEAD").stdout.trim();
  try {
    return { plugin: readPlugin(join(temp, sub)), source, from: `${address}${sub}`, commit: head, temp };
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}

function show(f: Fetched, replaces: LockEntry | undefined, say: Say): void {
  const { manifest } = f.plugin;
  say(`${manifest.name} ${manifest.version}: ${manifest.description}`);
  say(`  from ${f.from}${f.commit ? `, at commit ${f.commit.slice(0, 12)}` : ""}`);
  say(`  files ${f.plugin.files.length}, sha256 ${f.plugin.hash}`);
  if (replaces && replaces.sha256 !== f.plugin.hash)
    say(`  it replaces ${manifest.name} ${replaces.version} from ${replaces.source} in this workspace`);
  say("It adds:");
  for (const [kind, word] of [
    ["collectors", "collector"],
    ["gates", "gate"],
    ["lanes", "lane type"],
  ] as const) {
    for (const [type, t] of Object.entries(manifest[kind] ?? {})) {
      say(`  ${word} ${manifest.name}/${type}: ${t.description}`);
      say(`      runs: ${t.run}`);
    }
  }
  for (const w of f.plugin.workflows) {
    say(`  workflow ${w.name}, a file for .factor/workflows/`);
    for (const command of w.commands) say(`      it would run: ${command}`);
  }
  say(
    "Its commands run on this machine with your rights, like a command lane's. The hash covers the plugin's own files, not a program they call.",
  );
}

/** Copy a plugin into its folder under the factor home, allow it in this workspace, and pin it in the lock. */
function install(ws: Workspace, f: Fetched, lock: Lock, say: Say): void {
  const { manifest, hash } = f.plugin;
  const dest = installDir(manifest.name, hash);
  rmSync(dest, { recursive: true, force: true });
  for (const file of f.plugin.files) {
    mkdirSync(dirname(join(dest, file)), { recursive: true });
    cpSync(join(f.plugin.dir, file), join(dest, file));
  }
  if (readPlugin(dest).hash !== hash) {
    rmSync(dest, { recursive: true, force: true });
    throw new UserError(`The files of "${manifest.name}" changed while they were copied.`, "Add it again.");
  }
  lock[manifest.name] = {
    version: manifest.version,
    source: f.source,
    sha256: hash,
    ...(f.commit ? { commit: f.commit } : {}),
  };
  ws.local = { ...ws.local, plugins: { ...ws.local.plugins, [manifest.name]: hash } };
  for (const w of f.plugin.workflows) {
    const to = join(ws.factorDir, "workflows", `${w.name}.json`);
    if (existsSync(to))
      say(`workflow ${w.name}: a file of that name is already in .factor/workflows/, and was left as it is`);
    else {
      cpSync(join(dest, w.file), to);
      say(`workflow ${w.name}: copied to .factor/workflows/${w.name}.json. Read it before you run it.`);
    }
  }
  say(`installed ${manifest.name} ${manifest.version}`);
}

/** `softwarefactor add [source] [--yes] [--hash <sha256 start>]`. With no source: what the lock pins. */
export async function addCommand(
  ws: Workspace,
  args: string[],
  flags: { yes?: boolean; hash?: string },
  say: Say,
): Promise<number> {
  const lock = readLock(ws);
  const wanted: { source: string; pinned?: LockEntry }[] = args[0]
    ? [{ source: args[0] }]
    : Object.values(lock).map((pinned) => ({ source: pinned.source, pinned }));
  if (wanted.length === 0)
    throw new UserError(
      "Nothing to add: name a plugin, and the lock is empty.",
      "softwarefactor add <folder | owner/repo | name>",
    );
  const fetched: Fetched[] = [];
  try {
    for (const { source, pinned } of wanted) {
      const f = await fetchPlugin(source, process.cwd(), pinned?.commit);
      fetched.push(f);
      if (pinned && f.plugin.hash !== pinned.sha256) {
        throw new UserError(
          `The source of "${f.plugin.manifest.name}" (${source}) no longer gives the files the lock pins.`,
          `To take what it gives now, see it and say yes: softwarefactor add ${source}`,
        );
      }
      show(f, own(lock, f.plugin.manifest.name), say);
      if (flags.hash && !f.plugin.hash.startsWith(flags.hash)) {
        throw new UserError(
          `These are not the files that were shown for --hash ${flags.hash}: the source has changed.`,
          "Read the summary above, and use the command it prints.",
        );
      }
    }
    if (!flags.yes) {
      const pin = args[0] ? ` --hash ${fetched[0]?.plugin.hash.slice(0, 12)}` : "";
      say(
        `Nothing was installed. To install ${args[0] ? "it" : "them"}: softwarefactor add${args[0] ? ` ${args[0]}` : ""} --yes${pin}`,
      );
      return 0;
    }
    for (const f of fetched) install(ws, f, lock, say);
    writeFileSync(
      lockPath(ws),
      `${JSON.stringify(Object.fromEntries(Object.entries(lock).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`,
    );
    writeFileSync(join(ws.factorDir, "local.json"), `${JSON.stringify(ws.local, null, 2)}\n`);
    return 0;
  } finally {
    for (const f of fetched) if (f.temp) rmSync(f.temp, { recursive: true, force: true });
  }
}

/** `softwarefactor plugins --available`: what the index holds. */
export async function availableCommand(say: Say): Promise<number> {
  const index = await readDirectory();
  say(`From ${directoryAddress()}`);
  for (const p of index.plugins) say(`  ${p.name.padEnd(16)} ${p.description}`);
  say("Add one with `softwarefactor add <name>`: it is shown first, and installed on a yes.");
  return 0;
}

export { addsOf };
