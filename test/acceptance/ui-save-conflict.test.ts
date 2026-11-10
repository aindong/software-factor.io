// From the third critique of task 17: the floor must not save over a change made to the
// workflow's file elsewhere (an editor, another tab, an agent) without saying so.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { op, tool } from "../helpers/operator.ts";
import { agentLane, flowRepo, jsonOf, startUi, type Ui } from "../helpers/repo.ts";

interface Read {
  workflow: Record<string, unknown>;
  version: string;
  error?: string;
  fix?: string;
}
const repo = flowRepo({
  lanes: [agentLane("build", { on: { pass: "review", fail: "@stop" } }), agentLane("review")],
});
const path = ".factor/workflows/starter.json";
let ui: Ui;
beforeAll(async () => {
  ui = await startUi(repo);
}, 120_000);
afterAll(() => ui?.stop());
const read = async () => jsonOf<Read>(await ui.api("/api/workflows/starter"));
const save = (body: unknown) => ui.api("/api/workflows/starter", { method: "PUT", body });
/** Change the file as an editor would. */
const edit = (description: string) => {
  repo.write(path, `${JSON.stringify({ ...repo.json(path), description }, null, 2)}\n`);
};

describe("saving a workflow that was changed elsewhere", () => {
  it("a read comes with the version of the file that was read", async () => {
    const one = await read();
    expect(one.version).toMatch(/^[0-9a-f]{64}$/);
    expect((await read()).version).toBe(one.version);
    edit("Changed in an editor.");
    expect((await read()).version).not.toBe(one.version);
  });

  it("a save names the version it began from, and gets the new one back", async () => {
    const { workflow, version } = await read();
    const saved = await save({
      workflow: { ...workflow, description: "Changed on the floor." },
      base: version,
    });
    expect(saved.status).toBe(200);
    const after = await jsonOf<Read>(saved);
    expect(after.version).toMatch(/^[0-9a-f]{64}$/);
    expect(after.version).not.toBe(version);
    expect(after.version).toBe((await read()).version);
  });

  it("is refused when the file changed since it was read, and the change made elsewhere is kept", async () => {
    const { workflow, version } = await read();
    edit("Changed in an editor, after the floor read it.");
    const disk = repo.read(path);
    const refused = await save({
      workflow: { ...workflow, description: "The floor's stale copy." },
      base: version,
    });
    expect(refused.status).toBe(409);
    const body = await jsonOf<Read>(refused);
    expect(body.error).toMatch(/changed since/);
    expect(body.fix).toBeTruthy();
    expect(body.version).toBe((await read()).version);
    expect(repo.read(path)).toBe(disk);
    // the person may still decide to save over it, knowingly
    const over = await save({
      workflow: { ...workflow, description: "The floor's copy, on purpose." },
      base: version,
      over: true,
    });
    expect(over.status).toBe(200);
    expect(repo.json<{ description: string }>(path).description).toBe("The floor's copy, on purpose.");
  });

  it("is refused in the same way through the operation, and a save that names no version still saves", async () => {
    const got = await op<Read>(ui, "workflow_get", { name: "starter" });
    expect(got.body.version).toMatch(/^[0-9a-f]{64}$/);
    edit("Changed again in an editor.");
    const stale = {
      name: "starter",
      workflow: { ...got.body.workflow, description: "Stale." },
      base: got.body.version,
    };
    const refused = await op(ui, "workflow_save", stale);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/changed since/);
    expect(tool(repo, "workflow_save", stale).refused).toBe(true);
    expect(repo.json<{ description: string }>(path).description).toBe("Changed again in an editor.");
    const plain = await op(ui, "workflow_save", {
      name: "starter",
      workflow: { ...got.body.workflow, description: "No version named." },
    });
    expect(plain.status).toBe(200);
    expect(repo.json<{ description: string }>(path).description).toBe("No version named.");
    // a version that is not one is refused as input
    expect((await op(ui, "workflow_save", { ...stale, base: "nope" })).status).toBe(422);
    expect((await save({ workflow: got.body.workflow, base: 7 })).status).toBe(422);
  });
});
