// The guide for writing a lane is checked as a reader would use it: the lane it adds passes the
// checker in the starter that `init` writes, with the command lane it describes added after it, and the plugin guide's example
// is a manifest the factory reads.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Manifest } from "../../src/core/plugins/manifest.ts";
import { makeRepo } from "../helpers/repo.ts";

type Json = Record<string, unknown>;
const blocks = (file: string) =>
  [...readFileSync(file, "utf8").matchAll(/```json\n([\s\S]*?)```/g)].map(
    (m) => JSON.parse(m[1] ?? "") as Json,
  );

/** The starter that `init` writes, with the guide's new lane put in as the guide says. */
function starterWith(docs: Json, stage?: Json) {
  const repo = makeRepo();
  expect(repo.sf("init").status).toBe(0);
  const workflow = repo.json<{ lanes: Json[]; commands: Json }>(".factor/workflows/starter.json");
  const at = (id: string) => workflow.lanes.find((l) => l.id === id) as Json;
  (at("test").on as Json).pass = docs.id;
  workflow.lanes.splice(workflow.lanes.indexOf(at("ship")), 0, docs);
  if (stage) {
    (docs.on as Json).pass = stage.id;
    workflow.lanes.splice(workflow.lanes.indexOf(at("ship")), 0, stage);
    workflow.commands.stage = { description: "Puts the change on staging." };
  }
  repo.write(".factor/workflows/starter.json", `${JSON.stringify(workflow, null, 2)}\n`);
  return { repo, workflow };
}

it("the guide's lane passes the checker, put into the starter as the guide says", () => {
  const [docs] = blocks("docs/write-a-lane.md");
  const { repo, workflow } = starterWith(docs as Json);
  const r = repo.sf("check");
  expect(r.status, r.stdout + r.stderr).toBe(0);
  expect(r.stdout).toMatch(/^ok\s+\.factor\/workflows\/starter\.json$/m);
  expect(workflow.lanes.map((l) => l.id)).toEqual(["plan", "build", "review", "test", "docs", "ship"]);
  // the lane writes, so the checker asks it for a gate: the guide's lane names two
  expect((docs as Json).gates).toEqual(["protected", "tests-kept"]);
});

it("and still passes with the command lane it describes, and the workspace file it shows", () => {
  const [docs, stage, factory] = blocks("docs/write-a-lane.md") as [Json, Json, Json];
  const { repo, workflow } = starterWith(docs, stage);
  const file = repo.json<{ commands: Json }>(".factor/factory.json");
  Object.assign(file.commands, factory.commands);
  repo.write(".factor/factory.json", `${JSON.stringify(file, null, 2)}\n`);
  const r = repo.sf("check");
  expect(r.status, r.stdout + r.stderr).toBe(0);
  expect(workflow.lanes.map((l) => l.id)).toEqual([
    "plan",
    "build",
    "review",
    "test",
    "docs",
    "stage",
    "ship",
  ]);
  // a workflow that names a command the workspace does not define is refused at the run, by name
  expect(Object.keys(file.commands)).toEqual(["verify", "ship", "stage"]);
});

it("the plugin guide's example is a manifest the factory reads", () => {
  const manifest = blocks("docs/plugins.md").find((b) => "collectors" in b && "version" in b);
  expect(Manifest.safeParse(manifest).success).toBe(true);
  expect(readFileSync("docs/write-a-lane.md", "utf8")).toMatch(/\]\(plugins\.md/);
});
