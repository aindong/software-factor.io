// From the second review of task 14: what the server answers when a save cannot be written, which
// workflows it lists, and a file under assets/ that is not one.
import { chmodSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentLane, flowRepo, jsonOf, startUi, type Ui } from "../helpers/repo.ts";

const repo = flowRepo({
  lanes: [agentLane("build", { on: { pass: "review", fail: "@stop" } }), agentLane("review")],
});
const folder = join(repo.dir, ".factor/workflows");
let ui: Ui;
beforeAll(async () => {
  ui = await startUi(repo);
}, 120_000);
afterAll(async () => {
  chmodSync(folder, 0o755);
  await ui?.stop();
});

describe("the interface's server, second review", () => {
  it("answers in JSON when the workflow cannot be written, and leaves nothing behind", async () => {
    const workflow = { ...repo.json(".factor/workflows/starter.json"), description: "Changed." };
    chmodSync(folder, 0o555); // the folder cannot be written to
    const answer = await ui.api("/api/workflows/starter", { method: "PUT", body: { workflow } });
    chmodSync(folder, 0o755);
    expect(answer.status).toBe(500);
    expect(answer.headers.get("content-type") ?? "").toMatch(/json/);
    expect((await jsonOf<{ error: string }>(answer)).error).toMatch(/could not be written/);
    expect(readdirSync(folder).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    // and the next save goes through
    const again = await ui.api("/api/workflows/starter", { method: "PUT", body: { workflow } });
    expect(again.status).toBe(200);
  });

  it("lists only the workflows it would open", async () => {
    symlinkSync(join(folder, "starter.json"), join(folder, "linked.json"));
    mkdirSync(join(folder, "folder.json"));
    const { workflows } = await jsonOf<{ workflows: string[] }>(await ui.api("/api/workspace"));
    expect(workflows).toEqual(["starter"]);
  });

  it.each(["/assets/", "/assets/%E0%A4%A", "/assets/..%2Findex.html"])("answers 404 for %s", async (path) => {
    expect((await fetch(`${ui.url}${path}`)).status).toBe(404);
  });
});
