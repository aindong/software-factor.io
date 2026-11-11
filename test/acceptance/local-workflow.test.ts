// A machine may use a workflow of its own: `local.json`, which is not committed, names it, and
// `factory.json` keeps the one everybody shares.
import { expect, it } from "vitest";
import { passingScript, type Repo, readyRepo } from "../helpers/repo.ts";

/** A workspace with the shared workflow and a second one, "mine", that differs by its name. */
function twoWorkflows(): Repo {
  const repo = readyRepo({ verify: "true", script: passingScript });
  const mine = repo.json<{ name: string }>(".factor/workflows/starter.json");
  mine.name = "mine";
  repo.write(".factor/workflows/mine.json", `${JSON.stringify(mine, null, 2)}\n`);
  return repo;
}
function useHere(repo: Repo, workflow: string): void {
  const local = repo.json(".factor/local.json");
  repo.write(".factor/local.json", `${JSON.stringify({ ...local, workflow }, null, 2)}\n`);
}
const exported = (repo: Repo) =>
  JSON.parse(repo.sf("export").stdout).workflow?.name ?? repo.sf("export").stdout;

it("uses the workflow factory.json names when local.json names none", () => {
  const repo = twoWorkflows();
  expect(exported(repo)).toBe("starter");
});

it("uses the workflow local.json names, runs it, and leaves factory.json as it is", () => {
  const repo = twoWorkflows();
  const before = repo.read(".factor/factory.json");
  useHere(repo, "mine");
  expect(exported(repo)).toBe("mine");
  const run = repo.sf("run");
  expect(run.status, run.stdout + run.stderr).toBe(0);
  expect(repo.read(".factor/factory.json")).toBe(before);
}, 120_000);

it("says local.json is where to look when the workflow it names is not there", () => {
  const repo = twoWorkflows();
  useHere(repo, "gone");
  const run = repo.sf("run");
  expect(run.status).not.toBe(0);
  expect(run.stdout + run.stderr).toMatch(/local\.json/);
});

it("refuses a name that is no workflow name", () => {
  const repo = twoWorkflows();
  useHere(repo, "../elsewhere");
  const run = repo.sf("run");
  expect(run.status).not.toBe(0);
  expect(run.stdout + run.stderr).toMatch(/local\.json/);
});

it("keeps what else local.json holds when a role is bound", () => {
  const repo = twoWorkflows();
  const local = repo.json(".factor/local.json");
  const kept = { workflow: "mine", servers: { tracker: "print-1" }, skills: { "some/skill": "print-2" } };
  repo.write(".factor/local.json", `${JSON.stringify({ ...local, ...kept }, null, 2)}\n`);
  const add = repo.sf("account", "add", "spare", "--agent", "command", "--command", "true");
  expect(add.status, add.stdout + add.stderr).toBe(0);
  const bind = repo.sf("role", "bind", "author", "--account", "spare");
  expect(bind.status, bind.stdout + bind.stderr).toBe(0);
  expect(repo.json(".factor/local.json")).toMatchObject(kept);
});
