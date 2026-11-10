// What was installed is what was shown. A file that changes afterwards, or a lock that names
// other files, stops the plugin from being used until it is added (and so shown) again.
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { callsOf, installed, lock, makePlugin, useFlow } from "../helpers/plugin.ts";
import { commandLane, flowRepo } from "../helpers/repo.ts";

it("does not run an installed plugin whose files have changed", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const plugin = makePlugin();
  expect(repo.sf("add", plugin.dir, "--yes").status).toBe(0);
  useFlow(repo);
  appendFileSync(join(installed(repo), "collect.sh"), "\ntouch /tmp/owned\n");
  const collected = repo.sf("collect");
  expect(collected.stdout).toMatch(
    /collector board: could not collect: the plugin "acme" has changed since it was installed/,
  );
  const run = repo.sf("run");
  expect(run.status).toBe(1);
  expect(run.stderr).toMatch(/plugin "acme" has changed since it was installed/);
  expect(callsOf(plugin)).toEqual([]);

  expect(repo.sf("add", plugin.dir, "--yes").status).toBe(0);
  expect(repo.sf("collect").stdout).toContain("collected 1 new task");
});

it("does not run a plugin when the lock names other files than the ones that were allowed here", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const plugin = makePlugin();
  expect(repo.sf("add", plugin.dir, "--yes").status).toBe(0);
  useFlow(repo);
  // as a merged change would: the lock now pins something this machine never saw
  const pinned = lock(repo);
  writeFileSync(
    join(repo.dir, ".factor/plugins.lock.json"),
    JSON.stringify({ acme: { ...pinned.acme, sha256: "0".repeat(64) } }),
  );
  expect(repo.sf("collect").stdout).toMatch(/collector board: could not collect: the plugin "acme" .*lock/);
  expect(callsOf(plugin)).toEqual([]);
});

it("does not run a plugin whose files and lock were changed together: this machine allowed other files", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const plugin = makePlugin();
  expect(repo.sf("add", plugin.dir, "--yes").status).toBe(0);
  useFlow(repo);
  // someone changes the plugin, installs it elsewhere, and the new lock arrives here with a pull
  const other = flowRepo({ lanes: [commandLane("build", "true")] });
  other.home = repo.home;
  appendFileSync(join(plugin.dir, "collect.sh"), "\necho changed >> /dev/null\n");
  expect(other.sf("add", plugin.dir, "--yes").status).toBe(0);
  writeFileSync(join(repo.dir, ".factor/plugins.lock.json"), other.read(".factor/plugins.lock.json"));
  const r = repo.sf("collect");
  expect(r.stdout).toMatch(/collector board: could not collect: the plugin "acme" .*softwarefactor add/);
  expect(callsOf(plugin)).toEqual([]);
});

it("does not run a plugin that is on the machine but was never allowed in this workspace", () => {
  const first = flowRepo({ lanes: [commandLane("build", "true")] });
  const plugin = makePlugin();
  expect(first.sf("add", plugin.dir, "--yes").status).toBe(0);
  // a second workspace on the same machine, with the same lock and no approval of its own
  const second = flowRepo({ lanes: [commandLane("build", "true")] });
  second.home = first.home;
  useFlow(second);
  writeFileSync(join(second.dir, ".factor/plugins.lock.json"), first.read(".factor/plugins.lock.json"));
  const r = second.sf("run");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/plugin "acme" is not installed on this machine|not allowed/);
  expect(r.stderr).toContain("softwarefactor add");
  expect(callsOf(plugin)).toEqual([]);
});
