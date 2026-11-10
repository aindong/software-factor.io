// The installed plugin behind a `name/type@major` a workflow uses. A plugin is used only when the
// files on this machine are the ones the person was shown and said yes to here (the hash in
// `.factor/local.json`), and the ones the workspace's lock pins. Anything else is refused, with
// the command that shows the plugin again.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../errors.ts";
import { own } from "../schema/builtins.ts";
import { factorHome, type Workspace } from "../workspace.ts";
import { addsOf, type Plugin, readPlugin } from "./manifest.ts";

export interface LockEntry {
  version: string;
  source: string;
  sha256: string;
  /** For a plugin from a git repository: the commit it was read at. */
  commit?: string;
}
export type Lock = Record<string, LockEntry>;
export const lockPath = (ws: { factorDir: string }) => join(ws.factorDir, "plugins.lock.json");

export function readLock(ws: { factorDir: string }): Lock {
  try {
    const lock: unknown = JSON.parse(readFileSync(lockPath(ws), "utf8"));
    return typeof lock === "object" && lock !== null && !Array.isArray(lock) ? (lock as Lock) : {};
  } catch {
    return {};
  }
}

/** Where a plugin's files are kept: a folder for each content, so one machine can hold two versions. */
export const installDir = (name: string, hash: string) =>
  join(factorHome(), "plugins", name, hash.slice(0, 16));

const KIND = { collector: "collectors", gate: "gates", lane: "lanes" } as const;
const WORD = { collector: "collector", gate: "gate", lane: "lane type" } as const;
const read = new Map<string, Plugin>(); // a plugin's files are hashed once in a process

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
  const dir = installDir(name, allowed);
  let plugin = read.get(dir);
  if (!plugin) {
    try {
      plugin = readPlugin(dir);
    } catch {
      plugin = undefined; // a link planted in it, a manifest that no longer reads: it is not what was installed
    }
    if (plugin) read.set(dir, plugin);
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
  const major = /\d+/.exec(range ?? "")?.[0];
  if (major !== undefined && major !== plugin.manifest.version.split(".")[0]) {
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
