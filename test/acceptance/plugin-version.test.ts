// A workflow keeps the major version of a plugin it was written for.
import { expect, it } from "vitest";
import { makePlugin, runsOf, useFlow } from "../helpers/plugin.ts";
import { commandLane, flowRepo } from "../helpers/repo.ts";

it.each(["^2.0.0", "2.x", "2"])("refuses a workflow that asks for %s when 1.2.0 is installed", (range) => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const plugin = makePlugin();
  expect(repo.sf("add", plugin.dir, "--yes").status).toBe(0);
  useFlow(repo, (w) => {
    w.plugins = { acme: range };
  });
  const r = repo.sf("run");
  expect(r.status).toBe(1);
  expect(r.stderr).toContain(range);
  expect(r.stderr).toContain("1.2.0");
  expect(runsOf(repo)).toEqual([]);
});

it.each(["^1.0.0", "^1.2.0", "1.x", "1", "~1.2.0", "1.2.x", "1.2.0"])("accepts %s for 1.2.0", (range) => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const plugin = makePlugin();
  expect(repo.sf("add", plugin.dir, "--yes").status).toBe(0);
  useFlow(repo, (w) => {
    w.plugins = { acme: range };
  });
  expect(repo.sf("collect").stdout).toContain("collected 1 new task");
});
