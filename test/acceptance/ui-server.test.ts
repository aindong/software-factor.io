import { request } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentLane, flowRepo, jsonOf, startUi, type Ui } from "../helpers/repo.ts";

const repo = flowRepo({
  lanes: [agentLane("build", { on: { pass: "review", fail: "@stop" } }), agentLane("review")],
});
let ui: Ui;
beforeAll(async () => {
  ui = await startUi(repo);
}, 120_000);
afterAll(() => ui?.stop());

/** A request with a Host header of our choosing, which fetch does not allow. */
const withHost = (host: string, path: string) =>
  new Promise<number>((done) => {
    const { port } = new URL(ui.url);
    const req = request(
      { host: "127.0.0.1", port, path, headers: { host, "x-factor-token": ui.token } },
      (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      },
    );
    req.end();
  });

describe("softwarefactor ui", () => {
  it("serves the interface on this machine only, and lets no other origin read it", async () => {
    expect(new URL(ui.url).hostname).toBe("127.0.0.1");
    const page = await fetch(ui.url);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toMatch(/text\/html/);
    expect(ui.token.length).toBeGreaterThanOrEqual(32);
    expect(page.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("gives the workspace, its workflows and the one in use", async () => {
    const workspace = await jsonOf<{ name: string }>(await ui.api("/api/workspace"));
    expect(workspace).toMatchObject({ workflow: "starter", workflows: ["starter"] });
    expect(workspace.name).toBeTruthy();
  });

  it("gives a workflow as it is in its file, with what the checker says about it", async () => {
    type Body = { workflow: { lanes: { id: string }[] }; problems: unknown[] };
    const body = await jsonOf<Body>(await ui.api("/api/workflows/starter"));
    expect(body.workflow.lanes.map((l) => l.id)).toEqual(["build", "review"]);
    expect(body.problems).toEqual([]);
  });

  it("answers 404 for a workflow that is not there, and for a name that is not a name", async () => {
    expect((await ui.api("/api/workflows/nothing")).status).toBe(404);
    expect((await ui.api("/api/workflows/..%2F..%2Fpackage")).status).toBe(404);
  });

  it("refuses the API without the page's token, or with a wrong one", async () => {
    expect((await fetch(`${ui.url}/api/workspace`)).status).toBe(401);
    expect((await ui.api("/api/workspace", { headers: { "x-factor-token": "wrong" } })).status).toBe(401);
  });

  it("refuses a request that names another host, which is how another site would reach it", async () => {
    expect(await withHost("evil.example", "/api/workspace")).toBe(403);
    expect(await withHost("evil.example", "/")).toBe(403);
    expect(await withHost(new URL(ui.url).host, "/api/workspace")).toBe(200);
  });

  it("serves the page for a path inside the interface, and 404 for a file that is not there", async () => {
    expect((await fetch(`${ui.url}/runs`)).headers.get("content-type")).toMatch(/text\/html/);
    expect((await fetch(`${ui.url}/assets/nothing.js`)).status).toBe(404);
    expect((await fetch(`${ui.url}/..%2f..%2fpackage.json`)).headers.get("content-type")).not.toMatch(/json/);
  });
});
