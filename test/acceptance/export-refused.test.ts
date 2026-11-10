// An export that would carry something it must not is not printed at all.
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { edit } from "../helpers/collect.ts";
import { makePlugin } from "../helpers/plugin.ts";
import { exported, source } from "../helpers/sharing.ts";

it("refuses a workflow the checker refuses, saying where", () => {
  const repo = source();
  edit(repo, (w) => {
    (w.lanes as { on: { pass: string } }[])[0]!.on.pass = "nowhere";
  });
  const r = exported(repo);
  expect(r.status).toBe(1);
  expect(r.text).toBe("");
  expect(r.stderr).toMatch(/nowhere/);
});

it("refuses a role that has the name of an account on this machine", () => {
  const repo = source();
  const profile = mkdtempSync(join(tmpdir(), "sf-profile-"));
  expect(repo.sf("account", "add", "author", "--agent", "claude", "--profile", profile).status).toBe(0);
  const r = exported(repo);
  expect(r.status).toBe(1);
  expect(r.text).toBe("");
  expect(r.stderr).toMatch(/role "author".*account/s);
});

it("refuses a text that holds a path of this machine, and a plugin that was added from a folder", () => {
  const repo = source();
  repo.write(".factor/workflows/prompts/build.md", `Read ${homedir()}/notes/plan.md first.\n`);
  const path = exported(repo);
  expect(path.status).toBe(1);
  expect(path.text).toBe("");
  expect(path.stderr).toMatch(/lanes\[0\]\.agent\.prompt/);

  const other = source();
  expect(other.sf("add", makePlugin().dir, "--yes").status).toBe(0);
  edit(other, (w) => {
    w.plugins = { acme: "^1.0.0" };
    w.collectors.push({ id: "board", uses: "acme/board@1" });
  });
  const folder = exported(other);
  expect(folder.status).toBe(1);
  expect(folder.text).toBe("");
  expect(folder.stderr).toMatch(/plugin "acme".*folder/s);
});

it("refuses a prompt in a file that holds a secret", () => {
  const repo = source();
  repo.write(".factor/workflows/prompts/build.md", `Use the key ghp_${"a1B2".repeat(9)} to push.\n`);
  const r = exported(repo);
  expect(r.status).toBe(1);
  expect(r.text).toBe("");
  expect(r.stderr).toMatch(/secret|credential/i);
  expect(r.stderr).not.toContain("ghp_");
});
