// A plugin that is not what a plugin must be is not installed, and the output says what is wrong.
import { existsSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { installed, lock, makePlugin } from "../helpers/plugin.ts";
import { commandLane, flowRepo } from "../helpers/repo.ts";

// biome-ignore lint/suspicious/noExplicitAny: a manifest being broken on purpose
type M = Record<string, any>;
const faults: [string, (m: M) => unknown, RegExp][] = [
  ["no name", (m: M) => delete m.name, /name/],
  ["the name core", (m: M) => (m.name = "core"), /core/],
  ["a name that is no id", (m: M) => (m.name = "Acme Corp"), /name/],
  [
    "a type without its major version",
    (m: M) => {
      m.gates = { "no-fixme": m.gates["no-fixme@1"] };
    },
    /no-fixme/,
  ],
  ["a key it does not know", (m: M) => (m.postinstall = "curl x | sh"), /postinstall/],
  ["a type with no command", (m: M) => delete m.lanes["note@1"].run, /note@1/],
  ["a workflow outside its folder", (m: M) => (m.workflows = ["../../etc/flow.json"]), /workflows/],
  ["a workflow that is not there", (m: M) => (m.workflows = ["workflows/missing.json"]), /missing\.json/],
  ["a version that is no version", (m: M) => (m.version = "latest"), /version/],
];
it.each(faults)("refuses a manifest with %s", (_, change, said) => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const plugin = makePlugin(change as (m: M) => void);
  const r = repo.sf("add", plugin.dir, "--yes");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(said);
  expect(existsSync(installed(repo))).toBe(false);
  expect(lock(repo)).toEqual({});
});

it("refuses a folder with no manifest, a folder with a link in it, and a workflow of the plugin that the checker refuses", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const none = makePlugin();
  rmSync(join(none.dir, "factor-plugin.json"));
  expect(repo.sf("add", none.dir, "--yes").stderr).toMatch(/factor-plugin\.json/);

  const linked = makePlugin();
  symlinkSync("/etc/hosts", join(linked.dir, "hosts"));
  const r = repo.sf("add", linked.dir, "--yes");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/link/);

  const broken = makePlugin(() => {}, { "workflows/acme-flow.json": '{ "name": "acme-flow" }\n' });
  const b = repo.sf("add", broken.dir, "--yes");
  expect(b.status).toBe(1);
  expect(b.stderr).toMatch(/acme-flow/);
  expect(existsSync(installed(repo))).toBe(false);
});
