// A workflow uses a plugin's collector as `name/type@1`: the plugin's command is run with the
// collector's settings, and what it prints is queued.
import { expect, it } from "vitest";
import { tasks } from "../helpers/collect.ts";
import { callsOf, installed, makePlugin, useFlow } from "../helpers/plugin.ts";
import { commandLane, flowRepo } from "../helpers/repo.ts";

it("runs the plugin's collector with its settings and queues what it found", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const plugin = makePlugin();
  expect(repo.sf("add", plugin.dir, "--yes").status).toBe(0);
  useFlow(repo);
  const r = repo.sf("collect");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toContain("collected 1 new task");
  expect(tasks(repo)).toEqual([
    { collector: "board", key: "B-1", title: "From the board", body: "", labels: '["board"]' },
  ]);
  // the installed copy ran, in the workspace, with the collector's settings
  expect(callsOf(plugin)).toEqual([`collect {"project":"APP"} ${repo.dir} ${installed(repo)}`]);
});

it("names a plugin that is not installed, and a type the plugin does not have, with the way out", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  useFlow(repo);
  const missing = repo.sf("collect");
  expect(missing.status, missing.stderr).toBe(0);
  expect(missing.stdout).toMatch(
    /collector board: could not collect: the plugin "acme" is not installed on this machine\. .*softwarefactor add/,
  );

  const plugin = makePlugin((m) => {
    m.collectors = {};
  });
  expect(repo.sf("add", plugin.dir, "--yes").status).toBe(0);
  expect(repo.sf("collect").stdout).toMatch(
    /collector board: could not collect: the plugin "acme" 1\.2\.0 has no collector "board@1"/,
  );
});
