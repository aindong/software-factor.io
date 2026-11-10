// `softwarefactor add`: fetch a plugin, show what it holds and would run, and install it on a yes.
// A source is a folder, a git repository (`owner/repo`, with a folder and a ref if wanted), or a
// name the directory index knows. Nothing of the plugin is run here: it is only read and copied.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { UserError } from "../errors.ts";
import { own } from "../schema/builtins.ts";
import { oneLine } from "../text.ts";
import type { Workspace } from "../workspace.ts";
import { isPlainCommand, type Plugin, readPlugin } from "./manifest.ts";
import { installDir, type Lock, type LockEntry, lockPath, readLock } from "./use.ts";

type Say = (line: string) => void;
const DIRECTORY = "https://raw.githubusercontent.com/aindong/software-factor.io/main/directory/index.json";
// one part of a git source: no part may begin with a dash (an option to git) or be a step upwards
const PART = "(?!-)(?!\\.\\.?(?:/|#|$))[A-Za-z0-9_.-]+";
export const GIT_SOURCE = new RegExp(`^(${PART})/(${PART})((?:/${PART})*)(?:#((?!-)[A-Za-z0-9_./-]+))?$`);
const NAME = /^[a-z][a-z0-9-]*$/;

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
      const answer = await fetch(address, { signal: AbortSignal.timeout(15_000) });
      if (!answer.ok) throw new Error(`the server answered ${answer.status}`);
      text = await answer.text();
      if (text.length > 1_000_000) throw new Error("it is over 1 MB");
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
  if (!parsed.success) {
    throw new UserError(
      `The plugin index at ${address} is not an index.`,
      'An index is { "version": 1, "plugins": [{ "name", "description", "source" }] }.',
    );
  }
  return parsed.data;
}

interface Fetched {
  plugin: Plugin;
  /** What goes into the lock, so another machine can fetch the same. */
  source: string;
  /** Where it was read from, in full. */
  from: string;
  commit?: string;
  /** A folder to remove when done. */
  temp?: string;
}

/**
 * Read a plugin from its source. A folder is resolved against `base`: the directory the person is
 * in for a source they typed, the workspace for one the lock holds. `commit` asks for that commit
 * of a git source, not the tip.
 */
async function fetchPlugin(source: string, base: string, ws: Workspace, commit?: string): Promise<Fetched> {
  if (/^([./]|~(\/|$))/.test(source) || isAbsolute(source)) {
    const dir = resolve(base, source.replace(/^~(?=\/|$)/, process.env.HOME ?? "~"));
    // a folder named from where the person stood is kept as seen from the workspace, where the lock is read
    const kept = isAbsolute(source) || source.startsWith("~") ? source : relative(ws.root, dir) || ".";
    return {
      plugin: readPlugin(dir),
      source: /^[./]/.test(kept) ? kept : `./${kept}`,
      from: `the folder ${dir}`,
    };
  }
  if (NAME.test(source)) {
    const entry = (await readDirectory()).plugins.find((p) => p.name === source);
    if (!entry) {
      throw new UserError(
        `The index has no plugin "${source}" (${directoryAddress()}).`,
        "See what it has with `softwarefactor plugins --available`, or name a folder or owner/repo.",
      );
    }
    // an index is someone else's list: it may name repositories, not folders on this machine
    if (!GIT_SOURCE.test(entry.source)) {
      throw new UserError(
        `The index entry "${source}" does not name a repository (${directoryAddress()}).`,
        "An entry's source is owner/repo, with a folder and a ref if wanted.",
      );
    }
    const fetched = await fetchPlugin(entry.source, base, ws, commit);
    if (fetched.plugin.manifest.name !== source) {
      if (fetched.temp) rmSync(fetched.temp, { recursive: true, force: true });
      throw new UserError(
        `The index entry "${source}" leads to a plugin named "${fetched.plugin.manifest.name}".`,
        "Tell the keeper of the index.",
      );
    }
    return fetched;
  }
  const m = GIT_SOURCE.exec(source);
  if (!m) {
    throw new UserError(
      `"${source}" is not a plugin source.`,
      "Name a folder (./plugin), a repository (owner/repo, owner/repo/folder, owner/repo#branch-or-tag) or a name from the index.",
    );
  }
  const [, owner = "", named = "", sub = "", ref] = m;
  const repo = named.replace(/\.git$/, "");
  const address = `${process.env.FACTOR_GIT_BASE || "https://github.com/"}${owner}/${repo}.git`;
  const temp = mkdtempSync(join(tmpdir(), "sf-plugin-"));
  // Nothing of the repository may run while it is fetched: no hooks come with a clone, and the
  // large-file filter (which would call out to an address the repository names) is switched off.
  const quiet = ["-c", "filter.lfs.smudge=", "-c", "filter.lfs.process=", "-c", "filter.lfs.required=false"];
  const git = (...args: string[]) =>
    spawnSync("git", [...quiet, ...args], {
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" },
    });
  const failed = (what: string, r: { stderr: string; error?: Error }) => {
    rmSync(temp, { recursive: true, force: true });
    return new UserError(
      `Could not ${what} ${owner}/${repo}${ref ? `#${ref}` : ""}: ${oneLine(r.stderr || r.error?.message || "git failed", 300)}`,
      "Check the name, and that you can read the repository. A ref is a branch or a tag.",
    );
  };
  // No checkout, and no archive either: both would run whatever filter the person has set up for
  // their own files on the repository's. The files are read out of the commit one by one.
  const repoDir = join(temp, "repo");
  const cloned = git(
    "clone",
    "-q",
    "--depth",
    "1",
    "--no-tags",
    "--no-checkout",
    ...(ref ? ["--branch", ref] : []),
    "--",
    address,
    repoDir,
  );
  if (cloned.status !== 0) throw failed("fetch", cloned);
  let rev = "HEAD";
  if (commit && git("-C", repoDir, "rev-parse", "HEAD").stdout.trim() !== commit) {
    const got = git("-C", repoDir, "fetch", "-q", "--depth", "1", "--", "origin", commit);
    if (got.status !== 0) throw failed(`fetch the commit ${commit.slice(0, 12)} of`, got);
    rev = "FETCH_HEAD";
  }
  const head = git("-C", repoDir, "rev-parse", rev).stdout.trim();
  const files = join(temp, "files");
  mkdirSync(files);
  const listed = git(
    "-C",
    repoDir,
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    head,
    ...(sub ? ["--", sub.slice(1)] : []),
  );
  if (listed.status !== 0) throw failed("read", listed);
  const entries = listed.stdout.split("\0").filter(Boolean);
  if (entries.length > 2000)
    throw failed("read", { stderr: `it holds ${entries.length} files where the plugin should be` });
  for (const entry of entries) {
    const [, mode = "", oid = "", path = ""] = /^(\d+) \w+ ([0-9a-f]+)\t([\s\S]*)$/.exec(entry) ?? [];
    const to = resolve(files, path);
    if (!to.startsWith(`${files}/`) || path.split("/").some((part) => part === ".." || part === ".git")) {
      throw failed("read", { stderr: `a path in it leads out of the repository (${oneLine(path, 80)})` });
    }
    if (mode !== "100644" && mode !== "100755") {
      rmSync(temp, { recursive: true, force: true });
      throw new UserError(
        `The plugin holds a link or another repository (${oneLine(path, 80)}).`,
        "A plugin is plain files only.",
      );
    }
    const blob = spawnSync("git", ["-C", repoDir, "cat-file", "blob", oid], {
      timeout: 60_000,
      maxBuffer: 6_000_000,
    });
    if (blob.status !== 0)
      throw failed("read", { stderr: `the file ${oneLine(path, 80)} could not be read, or is over 5 MB` });
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, blob.stdout, { mode: mode === "100755" ? 0o755 : 0o644 });
  }
  try {
    // the folder inside the repository must be inside it: a link on the way could lead out
    if (!`${realpathSync(join(files, sub))}/`.startsWith(`${realpathSync(files)}/`)) {
      throw new UserError(
        `The folder ${sub} of ${owner}/${repo} leads out of the repository.`,
        "Name a folder that is in it.",
      );
    }
    return { plugin: readPlugin(join(files, sub)), source, from: `${address}${sub}`, commit: head, temp };
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    if (error instanceof UserError) throw error;
    throw new UserError(
      `There is no folder ${sub} in ${owner}/${repo}.`,
      "A plugin is a folder with a factor-plugin.json in it.",
    );
  }
}

function show(f: Fetched, replaces: LockEntry | undefined, gateEnv: string[], say: Say): void {
  const { manifest } = f.plugin;
  say(`${manifest.name} ${manifest.version}: ${manifest.description}`);
  say(`  from ${f.from}${f.commit ? `, at commit ${f.commit.slice(0, 12)}` : ""}`);
  say(`  files ${f.plugin.files.length}, sha256 ${f.plugin.hash}`);
  if (replaces && replaces.sha256 !== f.plugin.hash) {
    say(`  it replaces ${manifest.name} ${replaces.version} from ${replaces.source} in this workspace`);
  }
  say("It adds:");
  const kinds = [
    ["collectors", "collector"],
    ["gates", "gate"],
    ["lanes", "lane type"],
  ] as const;
  for (const [kind, word] of kinds) {
    for (const [type, t] of Object.entries(manifest[kind] ?? {})) {
      say(`  ${word} ${manifest.name}/${type}: ${t.description}`);
      say(`      runs: ${t.run}`);
    }
  }
  for (const w of f.plugin.workflows) {
    say(`  workflow ${w.name}, a file for .factor/workflows/`);
    // a command that is more than one plain line is shown as it is written, with its line breaks as \n
    for (const command of w.commands)
      say(`      it would run: ${isPlainCommand(command) ? command : JSON.stringify(command)}`);
  }
  say(
    "Its commands run on this machine with your rights, like a command lane's. The hash covers the plugin's own files, not a program they call.",
  );
  if (gateEnv.length > 0) {
    say(`They are given these variables of yours, as command lanes and gates are: ${gateEnv.join(", ")}.`);
  }
}

/** Make an installed plugin's files writable again, so that they can be replaced. */
function unlock(dir: string): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isDirectory()) unlock(path);
    else if (stat.isFile()) chmodSync(path, 0o644);
  }
}

const hashAt = (dir: string) => {
  try {
    return readPlugin(dir, "installed").hash;
  } catch {
    return undefined; // nothing there, or not what a plugin is
  }
};

/** Put a plugin's files into their folder under the factor home, unless the very same files are already there. */
function place(f: Fetched): string {
  const { manifest, hash } = f.plugin;
  const dest = installDir(manifest.name, hash);
  if (hashAt(dest) === hash) return dest; // another workspace may be running them: they are not touched
  unlock(dest);
  rmSync(dest, { recursive: true, force: true });
  for (const file of f.plugin.files) {
    mkdirSync(dirname(join(dest, file)), { recursive: true });
    copyFileSync(join(f.plugin.dir, file), join(dest, file));
  }
  if (hashAt(dest) !== hash) {
    rmSync(dest, { recursive: true, force: true });
    throw new UserError(`The files of "${manifest.name}" changed while they were copied.`, "Add it again.");
  }
  // Read-only from here on. That stops an accident. It does not stop a program with the person's
  // rights from making a file writable again: the hash at every use is what catches that.
  for (const file of f.plugin.files) chmodSync(join(dest, file), 0o444);
  return dest;
}

/** `softwarefactor add [source] [--yes] [--hash <sha256>]`. With no source: what the lock pins. */
export async function addCommand(
  ws: Workspace,
  args: string[],
  flags: { yes?: boolean; hash?: string },
  say: Say,
): Promise<number> {
  const lock: Lock = readLock(ws);
  const typed = args[0];
  if (!typed && flags.hash !== undefined) {
    throw new UserError(
      "--hash pins one plugin, and none was named.",
      "softwarefactor add <source> --yes --hash <sha256>",
    );
  }
  const wanted: { source: string; pinned?: LockEntry; as?: string }[] = typed
    ? [{ source: typed }]
    : Object.entries(lock).map(([as, pinned]) => ({ source: pinned.source, pinned, as }));
  if (wanted.length === 0) {
    throw new UserError(
      "Nothing to add: name a plugin, and the lock is empty.",
      "softwarefactor add <folder | owner/repo | name>",
    );
  }
  const fetched: Fetched[] = [];
  try {
    for (const { source, pinned, as } of wanted) {
      const f = await fetchPlugin(source, pinned ? ws.root : process.cwd(), ws, pinned?.commit);
      fetched.push(f);
      // a pin is for the plugin of its own name: another one behind it would take that plugin's place here
      if (as !== undefined && f.plugin.manifest.name !== as) {
        throw new UserError(
          `The lock pins "${as}" at ${source}, and the plugin there is named "${f.plugin.manifest.name}".`,
          "Take that entry out of .factor/plugins.lock.json, or add the plugin by its own source.",
        );
      }
      if (pinned && f.plugin.hash !== pinned.sha256) {
        throw new UserError(
          `The source of "${f.plugin.manifest.name}" (${source}) no longer gives the files the lock pins.`,
          `To take what it gives now, see it and say yes: softwarefactor add ${source}`,
        );
      }
      show(f, own(lock, f.plugin.manifest.name), ws.config.gateEnv ?? [], say);
      // the pin is the whole hash: a start of it could be matched by other files made for the purpose
      if (flags.hash !== undefined && f.plugin.hash !== flags.hash) {
        throw new UserError(
          `These are not the files that were shown for --hash ${oneLine(flags.hash, 80)}: the source has changed, or the hash is not the whole of it.`,
          "Read the summary above, and use the command it prints.",
        );
      }
    }
    if (!flags.yes) {
      const pin = typed ? ` --hash ${fetched[0]?.plugin.hash}` : "";
      say(
        `Nothing was installed. To install ${typed ? "it" : "them"}: softwarefactor add${typed ? ` ${typed}` : ""} --yes${pin}`,
      );
      return 0;
    }
    // files first, then the two records, then the workflows: a failure half way leaves no workflow of a plugin that is not recorded
    const placed = fetched.map((f) => ({ f, dest: place(f) }));
    let local = ws.local;
    for (const { f } of placed) {
      const { manifest, hash } = f.plugin;
      lock[manifest.name] = {
        version: manifest.version,
        source: f.source,
        sha256: hash,
        ...(f.commit ? { commit: f.commit } : {}),
      };
      local = { ...local, plugins: { ...local.plugins, [manifest.name]: hash } };
    }
    const sorted = Object.fromEntries(Object.entries(lock).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    writeFileSync(lockPath(ws), `${JSON.stringify(sorted, null, 2)}\n`);
    writeFileSync(join(ws.factorDir, "local.json"), `${JSON.stringify(local, null, 2)}\n`);
    for (const { f, dest } of placed) {
      for (const w of f.plugin.workflows) {
        const to = join(ws.factorDir, "workflows", `${w.name}.json`);
        try {
          // only into a name nothing has: not over a file, and not through a link that is waiting there
          copyFileSync(join(dest, w.file), to, constants.COPYFILE_EXCL);
          chmodSync(to, 0o644);
          say(`workflow ${w.name}: copied to .factor/workflows/${w.name}.json. Read it before you run it.`);
        } catch {
          say(
            `workflow ${w.name}: a file of that name is already in .factor/workflows/, and was left as it is`,
          );
        }
      }
      say(`installed ${f.plugin.manifest.name} ${f.plugin.manifest.version}`);
    }
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
