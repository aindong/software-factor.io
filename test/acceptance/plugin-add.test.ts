// `softwarefactor add <folder>`: what a plugin holds and would run is shown first, and it is
// installed only on a yes.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { op } from "../helpers/operator.ts";
import { installed, lock, makePlugin } from "../helpers/plugin.ts";
import { commandLane, flowRepo, startUi } from "../helpers/repo.ts";

it("shows what the plugin adds and runs, and installs nothing without a yes", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const plugin = makePlugin();
  const r = repo.sf("add", plugin.dir);
  expect(r.status, r.stderr).toBe(0);
  for (const said of [
    "acme 1.2.0",
    "A board, a gate and a lane for tests.",
    "acme/board@1",
    "acme/no-fixme@1",
    "acme/note@1",
    'sh "$FACTOR_PLUGIN_DIR/collect.sh"',
    'sh "$FACTOR_PLUGIN_DIR/gate.sh"',
    'sh "$FACTOR_PLUGIN_DIR/lane.sh"',
    "acme-flow",
    `softwarefactor add ${plugin.dir} --yes`,
  ])
    expect(r.stdout).toContain(said);
  expect(r.stdout).toMatch(/Nothing was installed/);
  expect(existsSync(installed(repo))).toBe(false);
  expect(lock(repo)).toEqual({});
});

it("installs on a yes: the files under the factor home, the lock beside the workflows, and the list names it", async () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const plugin = makePlugin();
  const r = repo.sf("add", plugin.dir, "--yes");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toContain("installed acme 1.2.0");
  expect(existsSync(join(installed(repo), "factor-plugin.json"))).toBe(true);
  expect(existsSync(join(installed(repo), "collect.sh"))).toBe(true);
  expect(lock(repo)).toEqual({
    acme: { version: "1.2.0", source: plugin.dir, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
  });

  const listed = repo.sf("plugins");
  expect(listed.stdout).toMatch(/acme 1\.2\.0.*acme\/board@1.*acme\/no-fixme@1.*acme\/note@1/s);
  const ui = await startUi(repo);
  try {
    const answer = await op<{
      installed: { name: string; version: string; adds: string[] }[];
      installing: string;
    }>(ui, "plugins_list");
    expect(answer.body.installed).toEqual([
      {
        name: "acme",
        version: "1.2.0",
        adds: ["acme/board@1", "acme/no-fixme@1", "acme/note@1", "workflow acme-flow"],
      },
    ]);
    expect(answer.body.installing).toContain("softwarefactor add");
    expect(answer.body.installing).toContain("acme 1.2.0");
  } finally {
    await ui.stop();
  }
});
