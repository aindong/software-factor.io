// Each workflow that ships with the factory can be exported and imported as it is.
import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { commandLane, flowRepo } from "../helpers/repo.ts";
import { clean, type Export, exported } from "../helpers/sharing.ts";

const shipped = readdirSync("workflows").filter((f) => f.endsWith(".json"));

it.each(shipped)("exports and imports %s", (file) => {
  const from = flowRepo({ lanes: [commandLane("build", "true")] });
  const workflow = JSON.parse(readFileSync(`workflows/${file}`, "utf8")) as { name: string };
  from.write(`.factor/workflows/${file}`, JSON.stringify(workflow));
  const out = exported(from, workflow.name);
  expect(out.status, out.stderr).toBe(0);
  expect((JSON.parse(out.text) as Export).workflow.name).toBe(workflow.name);
  const { repo, file: shared } = clean(out.text);
  const r = repo.sf("import", shared, "--yes");
  expect(r.status, r.stderr).toBe(0);
  expect(repo.sf("check", `.factor/workflows/${workflow.name}.json`).status).toBe(0);
});
