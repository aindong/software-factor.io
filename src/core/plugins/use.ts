// The installed plugin behind a `name/type@major` a workflow uses. A plugin is used only when the
// files on this machine are the ones the person was shown and said yes to here (the hash in
// `.factor/local.json`), and the ones the workspace's lock pins. Anything else is refused, with
// the command that shows the plugin again.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { UserError } from "../errors.ts";
import { own } from "../schema/builtins.ts";
import { factorHome, type Workspace } from "../workspace.ts";
import { addsOf, type Plugin, readPlugin } from "./manifest.ts";

// The lock is a shared file: it can arrive with a pull or a merge. Every value in it is held to
// a shape before it is used, so none can pass for an option to git or for a command to copy.
const LockEntry = z.strictObject({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  source: z.string().regex(/^(?!-)[A-Za-z0-9_.~/#@-]+$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  // for a plugin from a git repository: the commit it was read at
  commit: z
    .string()
    .regex(/^[0-9a-f]{40,64}$/)
    .optional(),
});
export type LockEntry = z.infer<typeof LockEntry>;
const LockFile = z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), LockEntry);
export type Lock = z.infer<typeof LockFile>;
export const lockPath = (ws: { factorDir: string }) => join(ws.factorDir, "plugins.lock.json");

/** The lock, or nothing when there is none. A lock that is not one is refused, never read as empty: the next add would write over it. */
export function readLock(ws: { factorDir: string }): Lock {
  if (!existsSync(lockPath(ws))) return {};
  let lock: unknown;
  try {
    lock = JSON.parse(readFileSync(lockPath(ws), "utf8"));
  } catch {
    lock = undefined;
  }
  const parsed = LockFile.safeParse(lock);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new UserError(
      `.factor/plugins.lock.json is not a lock the factory wrote (at ${issue?.path.join(".") || "the file"}).`,
      "Take the file back to its last good version, or remove the entry and add the plugin again.",
    );
  }
  return parsed.data;
}

/** Where a plugin's files are kept: a folder for each content, so one machine can hold two versions. */
export const installDir = (name: string, hash: string) =>
  join(factorHome(), "plugins", name, hash.slice(0, 16));

const KIND = { collector: "collectors", gate: "gates", lane: "lanes" } as const;
const WORD = { collector: "collector", gate: "gate", lane: "lane type" } as const;

/**
 * Whether an installed version fits what a workflow asks for. The forms read are "^1.2.0",
 * "~1.2.0", "1", "1.x", "1.2.x" and "1.2.0": the major version must be the one installed.
 */
export function fits(range: string, version: string): boolean | "unread" {
  const m = /^([\^~]?)(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(range.trim());
  if (!m) return "unread";
  const [, op, major, minor, patch] = m;
  const [vMajor = 0, vMinor = 0, vPatch = 0] = version.split(".").map(Number);
  if (Number(major) !== vMajor) return false;
  const wantMinor = minor === undefined || minor === "x" || minor === "*" ? undefined : Number(minor);
  const wantPatch = patch === undefined || patch === "x" || patch === "*" ? undefined : Number(patch);
  if (wantMinor === undefined) return true;
  // below 1.0.0 a caret keeps the minor version, as semver has it
  if (op === "^" && vMajor > 0)
    return vMinor > wantMinor || (vMinor === wantMinor && vPatch >= (wantPatch ?? 0));
  if (vMinor !== wantMinor) return false; // "~1.2.0", "1.2.x" and "1.2.0" keep the minor version
  return op !== "" || wantPatch === undefined ? vPatch >= (wantPatch ?? 0) : vPatch === wantPatch;
}

/** The plugin a workspace may use under a name. Throws, with the way out, when it may not. */
export function pluginOf(ws: Workspace, name: string): Plugin {
  const pinned = own(readLock(ws), name);
  const allowed = own(ws.local.plugins, name);
  const again = `softwarefactor add ${pinned?.source ?? name}`;
  if (!allowed || !existsSync(installDir(name, allowed))) {
    throw new UserError(
      `The plugin "${name}" is not installed on this machine.`,
      `See what it holds and install it with: ${again}`,
    );
  }
  // Hashed at every use, not once: a lane runs with the person's rights and could have rewritten
  // a gate since the run began. (At most 5 MB, so this is cheap.)
  let plugin: Plugin | undefined;
  try {
    plugin = readPlugin(installDir(name, allowed), "installed");
  } catch {
    plugin = undefined; // a link planted in it, a manifest that no longer reads: it is not what was installed
  }
  if (plugin?.hash !== allowed) {
    throw new UserError(
      `The plugin "${name}" has changed since it was installed.`,
      `See what it holds now and install it again with: ${again}`,
    );
  }
  if (pinned?.sha256 !== allowed) {
    throw new UserError(
      `The plugin "${name}" allowed on this machine is not the one the lock pins (.factor/plugins.lock.json).`,
      `See what the lock's version holds and install it with: ${again}`,
    );
  }
  const range = own(ws.workflow.plugins, name);
  const fit = range === undefined ? true : fits(range, plugin.manifest.version);
  if (fit === "unread") {
    throw new UserError(
      `"${range}" (for the plugin "${name}") is not a range the factory reads.`,
      'Write it as "^1.2.0", "~1.2.0", "1.x" or "1" under "plugins" in the workflow.',
    );
  }
  if (!fit) {
    throw new UserError(
      `The workflow asks for the plugin "${name}" ${range}, and ${plugin.manifest.version} is installed.`,
      'Install a version that fits, or change "plugins" in the workflow.',
    );
  }
  return plugin;
}

/** The command behind a plugin's type, and what it is given: its own folder and the settings, as JSON. */
export function pluginType(
  ws: Workspace,
  kind: keyof typeof KIND,
  uses: string,
  settings: unknown = {},
): { run: string; env: Record<string, string> } {
  const [name = "", type = ""] = uses.split("/");
  const plugin = pluginOf(ws, name);
  const found = own(plugin.manifest[KIND[kind]], type);
  if (!found) {
    const has = Object.keys(plugin.manifest[KIND[kind]] ?? {});
    throw new UserError(
      `The plugin "${name}" ${plugin.manifest.version} has no ${WORD[kind]} "${type}".`,
      has.length > 0 ? `It has: ${has.join(", ")}.` : `It adds no ${WORD[kind]}.`,
    );
  }
  return {
    run: found.run,
    env: { FACTOR_PLUGIN_DIR: plugin.dir, FACTOR_WITH: JSON.stringify(settings ?? {}) },
  };
}

/** The plugins this workspace has installed and allowed, for the list. One that may not be used is left out. */
export function installedPlugins(ws: Workspace): { name: string; version: string; adds: string[] }[] {
  return Object.keys(ws.local.plugins ?? {})
    .sort()
    .flatMap((name) => {
      try {
        const plugin = pluginOf(ws, name);
        return [{ name, version: plugin.manifest.version, adds: addsOf(plugin) }];
      } catch {
        return [];
      }
    });
}
