import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentLane, flowRepo, jsonOf, startUi, type Ui } from "../helpers/repo.ts";

type Problems = { problems: { path: string; message: string; fix: string }[] };

const repo = flowRepo({
  lanes: [agentLane("build", { on: { pass: "review", fail: "@stop" } }), agentLane("review")],
});
const path = ".factor/workflows/starter.json";
let ui: Ui;
beforeAll(async () => {
  ui = await startUi(repo);
}, 120_000);
afterAll(() => ui?.stop());
const save = (workflow: unknown, name = "starter") =>
  ui.api(`/api/workflows/${name}`, { method: "PUT", body: { workflow } });

describe("saving a workflow through the interface", () => {
  it("writes nothing when the checker finds problems, and gives each with its place and its fix", async () => {
    const before = repo.read(path);
    const broken = repo.json<{ lanes: { on: Record<string, string> }[] }>(path);
    (broken.lanes[0] as { on: Record<string, string> }).on.pass = "nowhere";
    const answer = await save(broken);
    expect(answer.status).toBe(422);
    const { problems } = await jsonOf<Problems>(answer);
    expect(problems[0]).toMatchObject({ path: expect.stringContaining("lanes[0].on.pass") });
    expect(problems[0]?.message).toBeTruthy();
    expect(problems[0]?.fix).toBeTruthy();
    expect(repo.read(path)).toBe(before);
  });

  it("writes a workflow with no problems as formatted JSON the checker accepts", async () => {
    const changed = repo.json<{ description: string }>(path);
    changed.description = "Changed in the interface.";
    const answer = await save(changed);
    expect(answer.status).toBe(200);
    expect(repo.read(path)).toBe(`${JSON.stringify(changed, null, 2)}\n`);
    expect(repo.sf("check").status).toBe(0);
  });

  it("checks without saving", async () => {
    const before = repo.read(path);
    const answer = await ui.api("/api/check", { method: "POST", body: { workflow: { version: 1 } } });
    expect(answer.status).toBe(200);
    expect((await jsonOf<Problems>(answer)).problems.length).toBeGreaterThan(0);
    expect(repo.read(path)).toBe(before);
  });

  it("refuses a body that is not a workflow at all, or far too large", async () => {
    expect((await ui.api("/api/workflows/starter", { method: "PUT", body: "text" })).status).toBe(422);
    const huge = { workflow: { description: "x".repeat(3_000_000) } };
    expect((await ui.api("/api/workflows/starter", { method: "PUT", body: huge })).status).toBe(413);
  });

  it("saves only under the workflows folder, under a name that is a name", async () => {
    const workflow = repo.json(path);
    expect((await save(workflow, "..%2Fescape")).status).toBe(404);
    expect((await save({ ...workflow, name: "other" }, "starter")).status).toBe(422); // the name inside must match the file
  });

  it("refuses to save without the token", async () => {
    const answer = await fetch(`${ui.url}/api/workflows/starter`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workflow: repo.json(path) }),
    });
    expect(answer.status).toBe(401);
  });
});
