// A plugin's workflow is copied into the workspace as a file to read and run. A file that is
// already there is the person's, and is left alone.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { makePlugin } from "../helpers/plugin.ts";
import { commandLane, flowRepo } from "../helpers/repo.ts";

it("copies the plugin's workflow in, and it passes the checker", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const plugin = makePlugin();
  const r = repo.sf("add", plugin.dir, "--yes");
  expect(r.status, r.stderr).toBe(0);
  expect(existsSync(join(repo.dir, ".factor/workflows/acme-flow.json"))).toBe(true);
  expect(r.stdout).toMatch(/workflow acme-flow.*\.factor\/workflows\/acme-flow\.json/);
  expect(repo.sf("check", ".factor/workflows/acme-flow.json").status).toBe(0);
});

it("leaves a workflow of that name that is already there, and says so", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  repo.write(".factor/workflows/acme-flow.json", '{ "mine": true }\n');
  const r = repo.sf("add", makePlugin().dir, "--yes");
  expect(r.status, r.stderr).toBe(0);
  expect(repo.read(".factor/workflows/acme-flow.json")).toBe('{ "mine": true }\n');
  expect(r.stdout).toMatch(/acme-flow.*already.*left/s);
});
