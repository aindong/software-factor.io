// `softwarefactor add owner/repo`: the plugin is fetched from a git repository, at its root or in
// a subfolder, at a ref if one is named, and the lock keeps the commit it came from.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { gitHost, installed, lock, makePlugin } from "../helpers/plugin.ts";
import { commandLane, flowRepo } from "../helpers/repo.ts";

const headOf = (base: string, owner: string, name: string, ref = "HEAD") =>
  execFileSync(
    "git",
    ["--git-dir", join(base.replace("file://", ""), owner, `${name}.git`), "rev-parse", ref],
    { encoding: "utf8" },
  ).trim();

it("adds a plugin from the root of a repository", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  repo.env.FACTOR_GIT_BASE = gitHost(makePlugin(), "acme", "factor-board");
  const r = repo.sf("add", "acme/factor-board", "--yes");
  expect(r.status, r.stderr).toBe(0);
  expect(existsSync(join(installed(repo), "collect.sh"))).toBe(true);
  expect(existsSync(join(installed(repo), ".git"))).toBe(false);
  expect(lock(repo).acme).toMatchObject({
    version: "1.2.0",
    source: "acme/factor-board",
    commit: headOf(repo.env.FACTOR_GIT_BASE, "acme", "factor-board"),
  });
});

it("adds a plugin from a subfolder, and from a named ref", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  repo.env.FACTOR_GIT_BASE = gitHost(makePlugin(), "acme", "tools", "plugins/board", "release");
  const r = repo.sf("add", "acme/tools/plugins/board#release", "--yes");
  expect(r.status, r.stderr).toBe(0);
  expect(existsSync(join(installed(repo), "factor-plugin.json"))).toBe(true);
  expect(lock(repo).acme).toMatchObject({
    source: "acme/tools/plugins/board#release",
    commit: headOf(repo.env.FACTOR_GIT_BASE, "acme", "tools", "release"),
  });
});

it("says so when the repository, the ref or the folder is not there", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  repo.env.FACTOR_GIT_BASE = gitHost(makePlugin(), "acme", "tools", "plugins/board");
  for (const [source, said] of [
    ["acme/nothing", /acme\/nothing/],
    ["acme/tools#no-such-ref", /no-such-ref/],
    ["acme/tools/not/here", /factor-plugin\.json/],
  ] as const) {
    const r = repo.sf("add", source, "--yes");
    expect(r.status, source).toBe(1);
    expect(r.stderr, source).toMatch(said);
  }
  expect(lock(repo)).toEqual({});
});
