// From the security review of task 20.
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  expect(folder.stderr).toMatch(/not a plain file/);
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
  (build.agent as { access: string }).access = "read"; // a panel reads: it does not write
  delete build.gates;
  build.panel = {
    join: "all",
    members: [
      { id: "first", prompt: { file: "prompts/x.md" } },
      { id: "second", prompt: "Look for logic errors." },
    ],
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

// ---- from the correctness review

it("refuses a pin whose source `softwarefactor add` could not read", () => {
  const doc = JSON.parse(exported(source()).text) as Export;
  doc.workflow.name = "shared";
  (doc.workflow as { plugins?: unknown }).plugins = { acme: "^1.0.0" };
  for (const bad of ["acme/tools#-x", "acme/tools//x", "acme/tools/"]) {
    doc.plugins = { acme: { version: "1.0.0", source: bad, sha256: "a".repeat(64), commit: "b".repeat(40) } };
    const { repo, file } = clean(JSON.stringify(doc));
    const r = repo.sf("import", file, "--yes");
    expect(r.status, bad).toBe(1);
    expect(r.stderr, bad).toMatch(/plugins/);
  }
});

it("imports into a workspace whose active workflow is broken: that is how it is mended", () => {
  const doc = JSON.parse(exported(source()).text) as Export;
  doc.workflow.name = "shared";
  const { repo, file } = clean(JSON.stringify(doc));
  repo.write(".factor/workflows/starter.json", "{ not json");
  const r = repo.sf("import", file, "--yes", "--use");
  expect(r.status, r.stderr).toBe(0);
  // the workspace works again: its active workflow is the imported one
  expect(repo.sf("check", ".factor/workflows/shared.json").status).toBe(0);
  expect(repo.sf("collect").status).toBe(0);
});

it("does not write an export over a file that is there, and does not take a path inside other words for this machine's", () => {
  const repo = source();
  const out = join(repo.home, "out.json");
  writeFileSync(out, "mine");
  const r = repo.sf("export", "--out", out);
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/already/);
  expect(readFileSync(out, "utf8")).toBe("mine");
  // the workspace's own folder name inside a longer path or word is not this machine's path
  const name = repo.dir.split("/").pop() ?? "";
  repo.write(".factor/workflows/prompts/build.md", `Look at docs/${name}x/notes.md and at x${repo.dir}y.\n`);
  expect(exported(repo).status).toBe(0);
  repo.write(".factor/workflows/prompts/build.md", `Look at ${repo.dir}/notes.md.\n`);
  expect(exported(repo).status).toBe(1);
});
