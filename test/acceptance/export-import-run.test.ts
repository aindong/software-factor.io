// The whole way: a workflow exported from one workspace runs in a clean folder that imported it.
import { expect, it } from "vitest";
import { commitFile, pass, trail } from "../helpers/repo.ts";
import { clean, type Export, exported, source } from "../helpers/sharing.ts";

it("runs an exported workflow in a clean folder, with a person in front of each lane", () => {
  // the names of the other workspace: a clean folder has no "checks" command and no "builder" role
  const text = exported(source()).text.replaceAll('"verify"', '"checks"').replaceAll('"author"', '"builder"');
  const doc = JSON.parse(text) as Export;
  doc.workflow.name = "shared";
  const { repo, file } = clean(JSON.stringify(doc));
  expect(repo.sf("import", file, "--yes", "--use").status).toBe(0);

  // not yet: the role is not bound and the command is not defined here, and the run says which
  const early = repo.sf("run");
  expect(early.status).toBe(1);
  expect(early.stderr).toMatch(/checks|builder/);

  // what a person does on the new machine: say what "checks" is here, and who works as the builder
  const factory = repo.json<{ commands: Record<string, string> }>(".factor/factory.json");
  repo.write(
    ".factor/factory.json",
    JSON.stringify({ ...factory, commands: { ...factory.commands, checks: "true" } }),
  );
  repo.write(
    ".factor/local.json",
    JSON.stringify({
      roles: { builder: { adapter: "fake", script: { build: [...commitFile("notes.txt"), pass()] } } },
    }),
  );
  repo.write(".factor/tasks.md", "- [ ] Do the thing\n");
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "use the shared workflow");

  const first = repo.sf("run");
  expect(first.stderr, first.stdout).toBe("");
  expect(repo.rows<{ workflow: string }>("select workflow from runs")).toEqual([{ workflow: "shared" }]);
  // the import put a person in front of the agent's work: it waits
  expect(repo.rows<{ status: string }>("select status from runs")).toEqual([{ status: "waiting" }]);
  const run = repo.rows<{ id: string }>("select id from runs")[0]?.id ?? "";
  // approved, the run goes on to the command lane, which asks before it runs (3: it waits for a person)
  const one = repo.sf("approve", run);
  expect(one.status, one.stdout + one.stderr).toBe(3);
  const last = repo.sf("approve", run);
  expect(repo.rows("select status from runs"), last.stdout + last.stderr).toEqual([{ status: "done" }]);
  expect(trail(repo)).toEqual(["build:pass", "ship:pass"]);
});
