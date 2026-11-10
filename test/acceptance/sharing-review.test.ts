// From the security review of task 20.
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { gitHost, lock, makePlugin } from "../helpers/plugin.ts";
import { clean, type Export, exported, source } from "../helpers/sharing.ts";

it("does not read a prompt file through a link out of the workflows folder, or a folder in its place", () => {
  const repo = source();
  writeFileSync(join(repo.dir, ".env"), "DB_PASSWORD=fake-not-real-value-123\n");
  const link = join(repo.dir, ".factor/workflows/prompts/build.md");
  rmSync(link);
  symlinkSync("../../../.env", link);
  const r = exported(repo);
  expect(r.text).not.toContain("fake-not-real-value-123");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/prompt/);
  rmSync(link);
  mkdirSync(link);
  const folder = exported(repo);
  expect(folder.status).toBe(1);
  expect(folder.stderr).not.toMatch(/EISDIR|at .*\.ts:/);
});

it("prints every text of the document on one line: a description cannot add lines to the listing", () => {
  const doc = exported(source()).doc;
  doc.workflow.name = "shared";
  const roles = doc.workflow.roles as Record<string, { description: string }>;
  if (roles.author) roles.author.description = "ok\n\n\nFAKE-LISTING-LINE";
  doc.workflow.description = "A flow.\nNothing was written. FAKE-END";
  const { repo, file } = clean(JSON.stringify(doc));
  const out = repo.sf("import", file).stdout;
  expect(out).not.toMatch(/^FAKE-LISTING-LINE$/m);
  expect(out).not.toMatch(/^Nothing was written\. FAKE-END$/m);
  expect(out).toContain("FAKE-LISTING-LINE"); // still shown, in its place
});

it("shows what a workspace command the workflow names already runs here", () => {
  const repo = source(); // defines verify = echo THE-VERIFY-LINE-OF-THIS-REPO
  const doc = exported(repo).doc;
  doc.workflow.name = "shared";
  const file = join(repo.home, "shared.json");
  writeFileSync(file, JSON.stringify(doc));
  const out = repo.sf("import", file).stdout;
  expect(out).toMatch(/command verify.*already defined here.*echo THE-VERIFY-LINE-OF-THIS-REPO/s);
  // and one that is not defined here is said to be still missing
  const { repo: other, file: shared } = clean(JSON.stringify(doc).replaceAll('"verify"', '"publish"'));
  expect(other.sf("import", shared).stdout).toMatch(/command publish.*define it/s);
});

it("refuses an export whose panel member keeps its prompt in a file", () => {
  const doc = JSON.parse(exported(source()).text) as Export;
  doc.workflow.name = "shared";
  const build = doc.workflow.lanes[0] as Record<string, unknown>;
  build.panel = {
    join: "all",
    members: [{ role: "reviewer", prompt: { file: "prompts/x.md" } }, { role: "author" }],
  };
  const { repo, file } = clean(JSON.stringify(doc));
  const r = repo.sf("import", file, "--yes");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/prompt/);
});

it("installs from the lock only a plugin that has the name the lock gives it", () => {
  // the lock says "other", the repository it names holds a plugin called "acme"
  const { repo } = clean("{}");
  repo.env.FACTOR_GIT_BASE = gitHost(makePlugin(), "someone", "other");
  const head = repo.env.FACTOR_GIT_BASE.replace("file://", "");
  const commit = repo.git("--git-dir", join(head, "someone", "other.git"), "rev-parse", "HEAD");
  const plugin = makePlugin();
  expect(repo.sf("add", plugin.dir).stdout).toMatch(/sha256 ([0-9a-f]{64})/);
  const sha256 = /sha256 ([0-9a-f]{64})/.exec(repo.sf("add", plugin.dir).stdout)?.[1] ?? "";
  repo.write(
    ".factor/plugins.lock.json",
    JSON.stringify({ other: { version: "1.2.0", source: "someone/other", sha256, commit } }),
  );
  const r = repo.sf("add", "--yes");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/"other".*"acme"/s);
  expect(Object.keys(lock(repo))).toEqual(["other"]);
});
