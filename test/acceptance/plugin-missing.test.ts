// A workflow that uses a plugin which is not on this machine does not start a run.
import { expect, it } from "vitest";
import { makePlugin, runsOf, useFlow } from "../helpers/plugin.ts";
import { commandLane, flowRepo } from "../helpers/repo.ts";

it("refuses to run before any run starts, and names the plugin and the command that installs it", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  useFlow(repo);
  const r = repo.sf("run");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/plugin "acme" is not installed on this machine/);
  expect(r.stderr).toMatch(/softwarefactor add/);
  expect(runsOf(repo)).toEqual([]);
});

it("refuses a lane type the installed plugin does not have", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const plugin = makePlugin((m) => {
    m.lanes = {};
  });
  expect(repo.sf("add", plugin.dir, "--yes").status).toBe(0);
  useFlow(repo);
  const r = repo.sf("run");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/plugin "acme" 1\.2\.0 has no lane type "note@1"/);
  expect(runsOf(repo)).toEqual([]);
});
