// An import never writes over a workflow that is already in the workspace.
import { expect, it } from "vitest";
import { clean, exported, source } from "../helpers/sharing.ts";

it("leaves a workflow of that name as it is, says so, and exits 1", () => {
  const { repo, file } = clean(exported(source()).text); // the export is named "starter", as init's own workflow is
  const mine = repo.read(".factor/workflows/starter.json");
  const r = repo.sf("import", file, "--yes", "--use");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/"starter" is already in this workspace/);
  expect(repo.read(".factor/workflows/starter.json")).toBe(mine);
});
