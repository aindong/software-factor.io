// Cases the plan's skeptic asked for, on the server.
import { writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentLane, flowRepo, jsonOf, startUi, type Ui } from "../helpers/repo.ts";

const repo = flowRepo({
  lanes: [agentLane("build", { on: { pass: "review", fail: "@stop" } }), agentLane("review")],
});
let ui: Ui;
beforeAll(async () => {
  writeFileSync(join(repo.dir, ".factor/workflows/broken.json"), "{ not json");
  ui = await startUi(repo);
}, 120_000);
afterAll(() => ui?.stop());
const port = () => Number(new URL(ui.url).port);
const status = (host: string | undefined, path = "/api/workspace", method = "GET") =>
  new Promise<number>((done) => {
    const headers: Record<string, string> = { "x-factor-token": ui.token };
    if (host !== undefined) headers.host = host;
    const req = httpRequest(
      { host: "127.0.0.1", port: port(), path, method, headers, setHost: false },
      (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      },
    );
    req.end();
  });

describe("the page that is served", () => {
  it("is the built one: its script is a file the server has, as JavaScript", async () => {
    const page = await (await fetch(ui.url)).text();
    const script = /<script type="module"[^>]+src="([^"]+)"/.exec(page)?.[1] ?? "";
    expect(script).toMatch(/^\/assets\/.+\.js$/);
    const answer = await fetch(`${ui.url}${script}`);
    expect(answer.status).toBe(200);
    expect(answer.headers.get("content-type")).toMatch(/javascript/);
    expect(answer.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("carries a content policy that loads from this server only", async () => {
    expect((await fetch(ui.url)).headers.get("content-security-policy")).toContain("default-src 'self'");
  });
});

describe("who can reach the server", () => {
  it("only this machine: it does not listen on the network's own address", async () => {
    const outside = Object.values(networkInterfaces())
      .flat()
      .find((a) => a && a.family === "IPv4" && !a.internal)?.address;
    if (!outside) return; // no network: nothing to try
    const refused = await new Promise<boolean>((done) => {
      const socket = connect({ host: outside, port: port() });
      socket.on("connect", () => {
        socket.destroy();
        done(false);
      });
      socket.on("error", () => done(true));
      socket.setTimeout(2000, () => {
        socket.destroy();
        done(true);
      });
    });
    expect(refused).toBe(true);
  });

  it.each([
    ["127.0.0.1.evil.example", 403],
    ["127.0.0.1:1", 403],
    ["", 403],
    [undefined, 403],
  ])("refuses the host %s", async (host, wanted) => {
    expect(await status(host === "127.0.0.1.evil.example" ? `${host}:${port()}` : host)).toBe(wanted);
  });

  it("answers to localhost with the same port", async () => {
    expect(await status(`localhost:${port()}`)).toBe(200);
  });

  it.each([
    ["POST", "/api/check"],
    ["DELETE", "/api/workflows/starter"],
    ["GET", "/api/nothing"],
    ["OPTIONS", "/api/workspace"],
  ])("wants the token for %s %s", async (method, path) => {
    const answer = await fetch(`${ui.url}${path}`, { method, headers: { origin: "https://evil.example" } });
    expect(answer.status).toBe(401);
    expect(answer.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("reads no file outside its own assets", async () => {
    for (const path of [
      "/assets/..%2f..%2fpackage.json",
      "/assets/..%2findex.html",
      "/assets/%2e%2e/index.html",
    ]) {
      const answer = await fetch(`${ui.url}${path}`);
      expect(answer.status, path).toBe(404);
    }
  });
});

describe("a workflow file that is not JSON", () => {
  it("is given as no workflow, with the reason as a problem", async () => {
    type Body = { workflow: unknown; problems: { path: string; message: string; fix: string }[] };
    const body = await jsonOf<Body>(await ui.api("/api/workflows/broken"));
    expect(body.workflow).toBeNull();
    expect(body.problems[0]?.message).toMatch(/not JSON/);
    expect(body.problems[0]?.fix).toBeTruthy();
  });
});

describe("a port that is taken", () => {
  it("is refused with what to do", () => {
    const again = repo.sf("ui", "--port", String(port()));
    expect(again.status).toBe(1);
    expect(again.stderr).toMatch(/in use/);
    expect(again.stderr).toMatch(/fix:.*--port/);
  });
});
