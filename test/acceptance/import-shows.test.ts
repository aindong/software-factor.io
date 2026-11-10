// `softwarefactor import <file>` shows what the workflow is and would run, and writes nothing.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { clean, exported, source } from "../helpers/sharing.ts";

it("shows the lanes, every command line, what must be bound and defined, and which lanes will wait", () => {
  const from = source();
  const doc = exported(from).doc;
  doc.workflow.mcp = { board: { from: "command", command: "npx", args: ["-y", "board-server@1.0.0"] } };
  doc.workflow.skills = { review: { from: "repo", source: "acme/skills", skill: "code-review" } };
  doc.plugins = { acme: { version: "1.2.0", source: "acme/factor-board", sha256: "a".repeat(64) } };
  (doc.workflow as { plugins?: unknown }).plugins = { acme: "^1.0.0" };
  const { repo, file } = clean(JSON.stringify(doc));
  const before = repo.git("status", "--porcelain");
  const r = repo.sf("import", file);
  expect(r.status, r.stderr).toBe(0);
  for (const said of [
    "starter",
    "A workflow built by a test.",
    "build",
    "ship",
    "echo shipped",
    '["npx","-y","board-server@1.0.0"]',
    "role author",
    "softwarefactor role bind author",
    "command verify",
    "The verify command.",
    "plugin acme 1.2.0",
    "acme/factor-board",
    "softwarefactor add",
    "skill review",
    "softwarefactor allow --skill review",
    "softwarefactor allow board",
    `softwarefactor import ${file} --yes`,
  ])
    expect(r.stdout, said).toContain(said);
  // the agent lane did not wait for a person where it came from: it will here
  expect(r.stdout).toMatch(/will wait for a person.*build/s);
  expect(r.stdout).toMatch(/Nothing was written/);
  expect(existsSync(join(repo.dir, ".factor/workflows/starter.json"))).toBe(true); // init's own starter, untouched
  expect(repo.git("status", "--porcelain")).toBe(before);
  expect(existsSync(join(repo.dir, ".factor/plugins.lock.json"))).toBe(false);
});
