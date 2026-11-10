// ADR 0008: everything the interface can do, the command line and the MCP server can do. One
// table of operations, and each layer serves all of it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { OPERATIONS } from "../../src/core/operations.ts";
import { ROUTE_OPS, startServer } from "../../src/core/server.ts";
import { op, operator, tool } from "../helpers/operator.ts";
import { agentLane, ensureUi, flowRepo, startUi, type Ui } from "../helpers/repo.ts";

const repo = flowRepo({ lanes: [agentLane("build")] });
let ui: Ui;
beforeAll(async () => {
  ui = await startUi(repo);
}, 120_000);
afterAll(() => ui?.stop());
const names = OPERATIONS.map((o) => o.name);

describe("the factory's operations", () => {
  it("have names every MCP client takes, each once, with words for what they do", () => {
    expect(names.length).toBeGreaterThanOrEqual(14);
    expect(new Set(names).size).toBe(names.length);
    for (const o of OPERATIONS) {
      expect(o.name).toMatch(/^[a-z][a-z0-9_]{1,63}$/);
      expect(o.description.length, o.name).toBeGreaterThan(20);
      expect(o.cli.length, o.name).toBeGreaterThan(0);
    }
    expect(names).toEqual(
      expect.arrayContaining([
        ...["workspace", "workflow_get", "workflow_check", "workflow_save"],
        ...["runs_list", "runs_get", "runs_file", "runs_diff", "inbox_list", "inbox_decide"],
        ...["accounts_list", "roles_bind", "costs", "plugins_list"],
      ]),
    );
  });

  it("are all served by the interface's API", async () => {
    for (const name of names) {
      const { status } = await op(ui, name, {});
      expect([200, 409, 422], `${name}: ${status}`).toContain(status);
    }
    expect((await op(ui, "no_such_thing")).status).toBe(404);
    expect((await op(ui, "constructor")).status).toBe(404);
    expect((await fetch(`${ui.url}/api/op/runs_list`, { method: "POST" })).status).toBe(401);
  });

  it("are all tools of the operator MCP server, with the same name, words and input", () => {
    const { answers } = operator(repo, [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {} },
      },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);
    const tools = answers.find((a) => a.id === 2)?.result?.tools as {
      name: string;
      description: string;
      inputSchema: unknown;
    }[];
    expect(tools.map((t) => t.name)).toEqual(names);
    for (const o of OPERATIONS) {
      const served = tools.find((t) => t.name === o.name);
      expect(served?.description, o.name).toBe(o.description);
      expect(served?.inputSchema, o.name).toEqual(JSON.parse(JSON.stringify(z.toJSONSchema(o.input))));
    }
  });

  it("each name a command the command line really has", () => {
    for (const o of OPERATIONS) {
      for (const words of o.cli) {
        const r = repo.sf(...words.filter((w) => !w.startsWith("<")));
        expect(r.stderr, `${o.name}: softwarefactor ${words.join(" ")}`).not.toContain("Unknown command");
        expect(repo.sf("--help").stdout, words[0]).toContain(`\n  ${words[0]}`);
      }
    }
  });

  it("cover every route the interface's server has under /api/", async () => {
    ensureUi();
    const served = await startServer(repo.dir, { workflow: "starter" }, 0);
    try {
      const routes = served.routes.filter((r) => r.includes(" /api/"));
      expect(routes.length).toBeGreaterThanOrEqual(10);
      for (const route of routes) {
        const name = ROUTE_OPS[route];
        expect(name, `${route} belongs to no operation`).toBeTruthy();
        expect(name === "*" || names.includes(name ?? ""), `${route} names "${name}"`).toBe(true);
      }
      // and the table names no route that is not there
      for (const route of Object.keys(ROUTE_OPS)) expect(routes, route).toContain(route);
    } finally {
      served.close();
    }
  });

  it("refuse an input their own schema refuses, in the API and the MCP server alike", async () => {
    const wrong: [string, unknown, RegExp][] = [
      ["inbox_decide", { run: 5, decision: "approve" }, /run/],
      ["inbox_decide", { run: "abc", decision: "maybe" }, /decision/],
      ["inbox_decide", { run: "abc", decision: "approve", extra: 1 }, /extra/],
      ["inbox_decide", { run: "--note", decision: "approve" }, /run/],
      ["inbox_decide", { run: "a; rm -rf x", decision: "approve" }, /run/],
      ["runs_get", {}, /run/],
      ["runs_get", { run: "../.." }, /run/],
      ["roles_bind", { role: "author" }, /account/],
      ["workflow_get", { name: "../factory" }, /name/],
      ["runs_list", { anything: true }, /anything/],
    ];
    for (const [name, input, where] of wrong) {
      const api = await op(ui, name, input);
      expect(api.status, `${name} ${JSON.stringify(input)}`).toBe(422);
      expect(`${api.body.path} ${api.body.error}`, name).toMatch(where);
      const served = tool(repo, name, input);
      expect(served.refused, `${name} ${JSON.stringify(input)}`).toBe(true);
      expect(served.text, name).toMatch(where);
    }
    // an input that is no object at all
    for (const input of [null, [], "x", 3]) expect((await op(ui, "runs_list", input)).status).toBe(422);
    expect(tool(repo, "no_such_thing").refused).toBe(true);
  });

  it("answer the same through the API and the MCP server", async () => {
    for (const name of ["workspace", "runs_list", "inbox_list", "plugins_list", "costs", "accounts_list"]) {
      expect(tool(repo, name).data, name).toEqual((await op(ui, name)).body);
    }
  });

  it("the operator server does not start inside a run", () => {
    const list = [{ jsonrpc: "2.0", id: 1, method: "tools/list" }];
    const inside = operator(repo, list, { FACTOR_RUN_ID: "abcd1234" });
    expect(inside.status).not.toBe(0);
    expect(inside.answers).toEqual([]);
    expect(inside.stderr).toMatch(/inside a run/);
    // and the guard denies an agent the command, with or without the variable
    expect(operator(repo, list).status).toBe(0);
  });
});
