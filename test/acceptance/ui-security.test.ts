// From the security review of task 14: who can reach the server, and what a save can touch.
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentLane, flowRepo, startUi, type Ui } from "../helpers/repo.ts";

const repo = flowRepo({
  lanes: [agentLane("build", { on: { pass: "review", fail: "@stop" } }), agentLane("review")],
});
const path = ".factor/workflows/starter.json";
let ui: Ui;
beforeAll(async () => {
  repo.write("victim.txt", "precious\n");
  symlinkSync("../../victim.txt", join(repo.dir, ".factor/workflows/evil.json"));
  ui = await startUi(repo);
}, 120_000);
afterAll(() => ui?.stop());

describe("the token", () => {
  it("is not in the page: a local process that asks for the page learns nothing it can use", async () => {
    const page = await (await fetch(ui.url)).text();
    expect(page).not.toContain(ui.token);
    expect(page).not.toMatch(/factor-token/);
    const guessed = /content="([0-9a-f]{32,})"/.exec(page)?.[1] ?? "";
    const answer = await fetch(`${ui.url}/api/workflows/starter`, {
      method: "PUT",
      headers: { "x-factor-token": guessed, "content-type": "application/json" },
      body: JSON.stringify({ workflow: repo.json(path) }),
    });
    expect(answer.status).toBe(401);
  });

  it("is given once, in the address the command prints, after the # so that it is never sent", () => {
    expect(ui.address).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#t=[0-9a-f]{48}$/);
    expect(ui.address.endsWith(ui.token)).toBe(true);
  });

  it("is in no answer of the API", async () => {
    for (const route of ["/api/workspace", "/api/workflows/starter"]) {
      expect(await (await ui.api(route)).text()).not.toContain(ui.token);
    }
  });
});

describe("what a save can touch", () => {
  it("does not write through a link out of the workflows folder", async () => {
    const workflow = { ...repo.json<Record<string, unknown>>(path), name: "evil" };
    const answer = await ui.api("/api/workflows/evil", { method: "PUT", body: { workflow } });
    expect(answer.status).toBe(404);
    expect(repo.read("victim.txt")).toBe("precious\n");
    expect((await ui.api("/api/workflows/evil")).status).toBe(404); // and does not read through it
  });

  it("refuses a key the checker cannot see", async () => {
    const workflow = repo.json<Record<string, unknown>>(path);
    const body = JSON.stringify({ workflow: { ...workflow, meta: { note: "x" } } }).replace(
      '"note":"x"',
      '"__proto__":"hidden"',
    );
    const answer = await fetch(`${ui.url}/api/workflows/starter`, {
      method: "PUT",
      headers: { "x-factor-token": ui.token, "content-type": "application/json" },
      body,
    });
    expect(answer.status).toBe(422);
    expect(repo.read(path)).not.toContain("__proto__");
  });
});

describe("the page", () => {
  it("cannot be put in a frame by another site, and sends its forms nowhere", async () => {
    const page = await fetch(ui.url);
    const policy = page.headers.get("content-security-policy") ?? "";
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(page.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });
});
