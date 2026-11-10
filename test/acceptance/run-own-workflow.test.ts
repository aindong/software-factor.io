// From the third critique of task 17: a run is drawn on the workflow as it was when the run
// started. Changing the workflow afterwards must not redraw what past runs did.
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { editWorkflow, jsonOf, startUi, type Ui } from "../helpers/repo.ts";
import { threeRuns } from "../helpers/runs.ts";

interface Row {
  id: string;
  sentence: string;
  stops: { id: string; name: string }[];
  own: boolean;
}
const { repo, done, stopped, waiting } = threeRuns();
const kept = (id: string) => join(repo.dir, ".factor/runs", id, "workflow.json");
const before = repo.read(".factor/workflows/starter.json");
// the workflow changes after the runs were made: a lane is renamed, one is taken out, one is added
editWorkflow(repo, (workflow) => {
  const lanes = workflow.lanes as unknown as { id: string; name?: string; on: Record<string, unknown> }[];
  const [build, check, ship] = lanes;
  if (!build || !check || !ship) throw new Error("the fixture changed");
  build.name = "Construct";
  check.on.pass = "@done";
  workflow.lanes = [build, check, { ...ship, id: "deploy", name: "Deploy" }] as never;
  check.on.pass = "deploy";
});
let ui: Ui;
let rows: Row[];
beforeAll(async () => {
  ui = await startUi(repo);
  rows = (await jsonOf<{ runs: Row[] }>(await ui.api("/api/runs"))).runs;
}, 120_000);
afterAll(() => ui?.stop());
const by = (id: string) => rows.find((r) => r.id === id) as Row;

describe("a run and the workflow it ran on", () => {
  it("the workflow is kept with the run when it starts, as the file was then", () => {
    for (const id of [done, stopped, waiting]) {
      expect(existsSync(kept(id)), id).toBe(true);
      expect(repo.read(`.factor/runs/${id}/workflow.json`)).toBe(before);
    }
  });

  it("the list gives each run the lanes of its own workflow, by the names they had", () => {
    for (const id of [done, stopped, waiting]) {
      expect(by(id).stops, id).toEqual([
        { id: "build", name: "Build" },
        { id: "check", name: "check" },
        { id: "ship", name: "Ship it" },
      ]);
      expect(by(id).own).toBe(true);
    }
    // the sentence names the lane as the run knew it
    expect(by(waiting).sentence).toBe("Ship it waits for your approval before it runs.");
  });

  it("one run comes with its own workflow, to draw its map on", async () => {
    const { run } = await jsonOf<{ run: { kept: { lanes: { id: string }[] } | null; own: boolean } }>(
      await ui.api(`/api/runs/${done}`),
    );
    expect(run.own).toBe(true);
    expect(run.kept?.lanes.map((l) => l.id)).toEqual(["build", "check", "ship"]);
  });

  it("a run from before its workflow was kept is drawn on today's, and says so", async () => {
    rmSync(kept(stopped));
    const again = (await jsonOf<{ runs: Row[] }>(await ui.api("/api/runs"))).runs.find(
      (r) => r.id === stopped,
    );
    expect(again?.own).toBe(false);
    expect(again?.stops.map((l) => `${l.id}:${l.name}`)).toEqual([
      "build:Construct",
      "check:check",
      "deploy:Deploy",
    ]);
    const { run } = await jsonOf<{ run: { kept: unknown; own: boolean } }>(
      await ui.api(`/api/runs/${stopped}`),
    );
    expect(run.own).toBe(false);
    expect(run.kept).toBeNull();
  });

  it("a kept workflow that does not read, or is a link, is not trusted: today's is used", async () => {
    const { writeFileSync, symlinkSync } = await import("node:fs");
    rmSync(kept(done));
    writeFileSync(kept(done), "{ not json");
    rmSync(kept(waiting));
    symlinkSync(join(repo.dir, ".factor/local.json"), kept(waiting));
    const again = (await jsonOf<{ runs: Row[] }>(await ui.api("/api/runs"))).runs;
    for (const id of [done, waiting]) {
      const row = again.find((r) => r.id === id);
      expect(row?.own, id).toBe(false);
      expect(
        row?.stops.map((l) => l.id),
        id,
      ).toEqual(["build", "check", "deploy"]);
    }
  });
});
