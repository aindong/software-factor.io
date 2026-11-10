// Helpers for the plugin tests: a plugin folder made on the spot, with commands that write down
// how they were called (outside the plugin's folder: its files must not change once installed).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Repo } from "./repo.ts";

type Json = Record<string, unknown>;

export interface Plugin {
  dir: string;
  /** One line for each run of one of its commands: "<kind> <FACTOR_WITH> <where it ran> <its own folder>". */
  log: string;
  manifest: Json;
}

/** A plugin "acme" with a collector, a gate, a lane type and a workflow. `change` edits the manifest. */
export function makePlugin(
  change: (manifest: Json) => void = () => {},
  files: Record<string, string> = {},
): Plugin {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), "sf-plugin-"))), "acme");
  const log = join(dirname(dir), "calls.log");
  const said = (kind: string) => `echo "${kind} $FACTOR_WITH $(pwd) $FACTOR_PLUGIN_DIR" >> "${log}"`;
  const manifest: Json = {
    name: "acme",
    version: "1.2.0",
    description: "A board, a gate and a lane for tests.",
    collectors: {
      "board@1": { description: "Open items of the board.", run: 'sh "$FACTOR_PLUGIN_DIR/collect.sh"' },
    },
    gates: {
      "no-fixme@1": { description: "No FIXME in the change.", run: 'sh "$FACTOR_PLUGIN_DIR/gate.sh"' },
    },
    lanes: { "note@1": { description: "Leaves a note.", run: 'sh "$FACTOR_PLUGIN_DIR/lane.sh"' } },
    workflows: ["workflows/acme-flow.json"],
  };
  change(manifest);
  const all: Record<string, string> = {
    "factor-plugin.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "collect.sh": `${said("collect")}\necho '[{"key":"B-1","title":"From the board","labels":["board"]}]'\n`,
    "gate.sh": `${said("gate")}\n! grep -rq FIXME --include='*.txt' .\n`,
    "lane.sh": `${said("lane")}\ntest "$(echo "$FACTOR_WITH" | grep -c fail)" = 0\n`,
    "workflows/acme-flow.json": `${JSON.stringify(flow(), null, 2)}\n`,
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return { dir, log, manifest };
}

/** A workflow that uses the plugin's collector, lane type and gate. */
export const flow = (): Json => ({
  $schema: "https://softwarefactor.io/schema/workflow/v1.json",
  version: 1,
  name: "acme-flow",
  description: "Tasks from the board, a note, a check.",
  plugins: { acme: "^1.0.0" },
  roles: { author: { description: "Writes." } },
  limits: { minutes: 30, tokens: 100000 },
  collectors: [{ id: "board", uses: "acme/board@1", with: { project: "APP" } }],
  gates: { fixme: { uses: "acme/no-fixme@1", with: { strict: true }, onFail: "fail" } },
  lanes: [
    {
      id: "note",
      uses: "acme/note@1",
      with: { say: "hello" },
      checkpoint: "out",
      on: { pass: "build", fail: "@stop" },
    },
    {
      id: "build",
      uses: "core/agent@1",
      agent: { role: "author", access: "write", prompt: "Build it." },
      gates: ["fixme"],
      checkpoint: "out",
      on: { pass: "@done", fail: "@stop" },
    },
  ],
});

export const callsOf = (plugin: Plugin) =>
  existsSync(plugin.log) ? readFileSync(plugin.log, "utf8").trim().split("\n") : [];

/** Make the workspace run the plugin's workflow. */
export function useFlow(repo: Repo, change: (workflow: Json) => void = () => {}): void {
  const workflow = flow();
  change(workflow);
  repo.write(".factor/workflows/acme-flow.json", `${JSON.stringify(workflow, null, 2)}\n`);
  const factory = repo.json<Json>(".factor/factory.json");
  repo.write(".factor/factory.json", `${JSON.stringify({ ...factory, workflow: "acme-flow" }, null, 2)}\n`);
}

export const installed = (repo: Repo, name = "acme") => join(repo.home, "plugins", name);
export const lock = (repo: Repo) =>
  existsSync(join(repo.dir, ".factor/plugins.lock.json"))
    ? repo.json<Record<string, { version: string; source: string; sha256: string; commit?: string }>>(
        ".factor/plugins.lock.json",
      )
    : {};

/** Put a plugin folder into a bare git repository under `<base>/<owner>/<repo>.git`, at a subfolder if given. Returns the base as a file address. */
export function gitHost(plugin: Plugin, owner: string, name: string, sub = "", branch = "main"): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "sf-githost-")));
  const work = join(base, "work");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: work, encoding: "utf8" }).trim();
  mkdirSync(join(work, sub), { recursive: true });
  execFileSync("cp", ["-R", `${plugin.dir}/.`, join(work, sub)]);
  git("init", "-q", "-b", branch);
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-q", "-m", "the plugin");
  mkdirSync(join(base, owner), { recursive: true });
  execFileSync("git", ["clone", "-q", "--bare", work, join(base, owner, `${name}.git`)]);
  return `file://${base}/`;
}
