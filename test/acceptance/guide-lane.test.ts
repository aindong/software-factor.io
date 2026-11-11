// The guide for writing a lane is checked as a reader would use it: its workflow passes the
// checker as it stands, with the command lane it describes added, and the plugin guide's example
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

it("the guide's workflow passes the checker as it stands", () => {
  const [workflow] = blocks("docs/write-a-lane.md");
  const repo = makeRepo();
  expect(repo.sf("init").status).toBe(0);
  repo.write(".factor/workflows/with-review.json", `${JSON.stringify(workflow, null, 2)}\n`);
  const r = repo.sf("check");
  expect(r.status, r.stdout + r.stderr).toBe(0);
  expect(r.stdout).toMatch(/^ok\s+\.factor\/workflows\/with-review\.json$/m);
  expect((workflow?.lanes as Json[]).map((l) => l.id)).toEqual(["work", "review"]);
});

it("and still passes with the command lane it describes, and the workspace file it shows", () => {
  const [workflow, lane, factory] = blocks("docs/write-a-lane.md") as [Json, Json, Json];
  const lanes = workflow.lanes as Json[];
  (lanes[1]?.on as Json).pass = lane.id;
  lanes.push(lane);
  (workflow.commands as Json).stage = { description: "Puts the change on staging." };
  const repo = makeRepo();
  expect(repo.sf("init").status).toBe(0);
  repo.write(".factor/workflows/with-review.json", `${JSON.stringify(workflow, null, 2)}\n`);
  repo.write(".factor/factory.json", `${JSON.stringify(factory, null, 2)}\n`);
  const r = repo.sf("check");
  expect(r.status, r.stdout + r.stderr).toBe(0);
  // a workflow that names a command the workspace does not define is refused at the run, by name
  expect(Object.keys(factory.commands as Json)).toContain("stage");
});

it("the plugin guide's example is a manifest the factory reads", () => {
  const manifest = blocks("docs/plugins.md").find((b) => "collectors" in b && "version" in b);
  expect(Manifest.safeParse(manifest).success).toBe(true);
  expect(readFileSync("docs/write-a-lane.md", "utf8")).toMatch(/\]\(plugins\.md/);
});
