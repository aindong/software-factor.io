// A collector that cannot collect says why, by name, and the others still collect.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { MIGRATIONS } from "../../src/core/db.ts";
import { edit, standIn, tasks } from "../helpers/collect.ts";
import { commandLane, flowRepo } from "../helpers/repo.ts";

it("collects from the file when gh is not signed in, and says what gh said", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")], tasks: "- [ ] From the file\n" });
  edit(repo, (w) => {
    w.collectors = [
      { id: "issues", uses: "core/github-issues@1", with: { label: "factory" } },
      { id: "tasks", uses: "core/file@1", with: { path: ".factor/tasks.md" } },
    ];
  });
  standIn(repo, "gh", 'echo "To get started with GitHub CLI, please run:  gh auth login" >&2; exit 4');
  const r = repo.sf("collect");
  expect(r.status, r.stderr).toBe(0);
  expect(tasks(repo).map((t) => `${t.collector}:${t.title}`)).toEqual(["tasks:From the file"]);
  expect(r.stdout).toContain("collected 1 new task");
  expect(r.stdout).toMatch(/collector issues: could not collect: .*gh auth login/);
});

it("says so when gh prints something that is not a list of issues", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  edit(repo, (w) => {
    w.collectors = [{ id: "issues", uses: "core/github-issues@1", with: { label: "factory" } }];
  });
  standIn(repo, "gh", "echo 'not json'");
  const r = repo.sf("collect");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toMatch(/collector issues: could not collect: /);
  expect(tasks(repo)).toEqual([]);
});

it("says that gh is not installed when it is not on PATH", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  edit(repo, (w) => {
    w.collectors = [{ id: "issues", uses: "core/github-issues@1", with: { label: "factory" } }];
  });
  repo.env.PATH = "/usr/bin:/bin"; // git lives here, and gh does not (if it does, this machine cannot show the case)
  if (existsSync("/usr/bin/gh") || existsSync("/bin/gh")) return;
  const r = repo.sf("collect");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toMatch(/collector issues: could not collect: .*gh\) is not installed/);
});

it("says it under `softwarefactor run` too, and still runs the file's task", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")], tasks: "- [ ] From the file\n" });
  edit(repo, (w) => {
    w.collectors = [
      { id: "issues", uses: "core/github-issues@1", with: { label: "factory" } },
      { id: "tasks", uses: "core/file@1", with: { path: ".factor/tasks.md" } },
    ];
  });
  standIn(repo, "gh", 'echo "HTTP 401: Bad credentials" >&2; exit 1');
  const r = repo.sf("run");
  expect(r.stdout + r.stderr).toMatch(/collector issues: could not collect: HTTP 401: Bad credentials/);
  expect(repo.rows<{ status: string }>("select status from runs")).toEqual([{ status: "done" }]);
});

it("names a collector whose type is not on this machine, and goes on", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")], tasks: "- [ ] From the file\n" });
  edit(repo, (w) => {
    w.plugins = { acme: "^1.0.0" };
    w.collectors = [
      { id: "board", uses: "acme/board@1", with: { project: "APP" } },
      { id: "tasks", uses: "core/file@1", with: { path: ".factor/tasks.md" } },
    ];
  });
  const r = repo.sf("collect");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toMatch(
    /collector board: could not collect: the plugin "acme" is not installed on this machine/,
  );
  expect(tasks(repo).map((t) => t.title)).toEqual(["From the file"]);
});

it("reads a database made before tasks had labels", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")], tasks: "" });
  // a database as it was before the labels: every migration up to that one, and a task from then
  const before = MIGRATIONS.findIndex((m) => m.includes("add column labels"));
  expect(before).toBeGreaterThan(0);
  const db = new DatabaseSync(join(repo.dir, ".factor/state.db"));
  for (const migration of MIGRATIONS.slice(0, before)) db.exec(migration);
  db.exec(`pragma user_version = ${before}`);
  db.prepare(
    "insert into tasks (collector, key, title, body, created_at) values ('tasks', 'old', 'An old task', '', ?)",
  ).run(new Date().toISOString());
  db.close();
  const r = repo.sf("run");
  expect(r.status, r.stdout + r.stderr).toBe(0);
  expect(tasks(repo)).toEqual([
    { collector: "tasks", key: "old", title: "An old task", body: "", labels: "[]" },
  ]);
  expect(repo.rows<{ status: string }>("select status from runs")).toEqual([{ status: "done" }]);
});
