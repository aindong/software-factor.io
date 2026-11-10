// ADR 0008: everything the interface can do, the command line and the MCP server can do. One
// table of operations, and each layer serves all of it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { FACTOR_TOOLS } from "../../src/core/agents/factor-tools.ts";
import { OPERATIONS } from "../../src/core/operations.ts";
import { ROUTE_OPS, startServer } from "../../src/core/server.ts";
import { op, operator, tool } from "../helpers/operator.ts";
import {
  agentLane,
  commitFile,
  ensureUi,
  flowRepo,
  mcp,
  pass,
  runRow,
  startUi,
  type Ui,
} from "../helpers/repo.ts";

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
    const none = await op(ui, "no_such_thing");
    expect(none.status).toBe(404);
    expect(none.body.error).toBe("There is no such operation.");
    for (const name of names)
      expect((await op(ui, name, {})).body.error, name).not.toBe("There is no such operation.");
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

  it("are not given to an agent inside a lane: its server still has its five tools and no other", () => {
    const { answers } = mcp(repo, { run: "r1", lane: "build" }, [
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);
    const tools = (answers.find((a) => a.id === 2)?.result?.tools ?? []) as { name: string }[];
    expect(tools.map((t) => t.name)).toEqual([...FACTOR_TOOLS]);
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

  it("each read is a command the command line runs to the end, with every word and flag", () => {
    const done = flowRepo({
      lanes: [agentLane("build", { agent: { access: "write" }, gates: ["verify"] })],
      scripts: { author: { build: [...commitFile("a.txt"), pass()] } },
    });
    expect(done.sf("run").status).toBe(0);
    const run = runRow(done)?.id ?? "";
    for (const o of OPERATIONS.filter((x) => !x.changes)) {
      for (const words of o.cli) {
        const r = done.sf(...words.map((w) => (w === "<run>" ? run : w)));
        expect(r.status, `${o.name}: softwarefactor ${words.join(" ")}\n${r.stderr}`).toBe(0);
        expect(r.stdout.trim().length, words.join(" ")).toBeGreaterThan(0);
      }
    }
    // a word or a flag the command line does not have is not taken for one it has
    expect(done.sf("runs", run, "--dif").status).not.toBe(0);
    expect(done.sf("runs", run, "--diff").stdout).toContain("a.txt");
    expect(done.sf("runs", "--diff").status).not.toBe(0);
  }, 120_000);

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
      ["inbox_decide", { run: 5, item: 1, decision: "approve" }, /run/],
      ["inbox_decide", { run: "abc", item: 1, decision: "maybe" }, /decision/],
      ["inbox_decide", { run: "abc", item: 1, decision: "approve", extra: 1 }, /extra/],
      ["inbox_decide", { run: "--note", item: 1, decision: "approve" }, /run/],
      ["inbox_decide", { run: "a; rm -rf x", item: 1, decision: "approve" }, /run/],
      ["runs_get", {}, /run/],
      ["runs_get", { run: "../.." }, /run/],
      ["roles_bind", { role: "author" }, /account/],
      ["workflow_get", { name: "../factory" }, /name/],
      ["runs_list", { anything: true }, /anything/],
    ];
    // every operation too, given all it needs and one key it does not know: no schema lets a key through
    const needs: Record<string, Record<string, unknown>> = {
      workflow_get: { name: "starter" },
      workflow_check: { workflow: {} },
      workflow_save: { name: "starter", workflow: {} },
      runs_get: { run: "abc" },
      runs_file: { run: "abc", path: "x" },
      runs_diff: { run: "abc" },
      inbox_decide: { run: "abc", item: 1, decision: "approve" },
      roles_bind: { role: "author", account: "work" },
      ladder_accept: { lane: "build" },
    };
    const cases = [
      ...wrong,
      ...names.map((name): [string, unknown, RegExp] => [name, { ...needs[name], nope: 1 }, /nope/]),
    ];
    // the API first, then the MCP server in one go: a call to it holds this process up
    const api = [];
    for (const [name, input] of cases) api.push(await op(ui, name, input));
    const { answers } = operator(
      repo,
      cases.map(([name, input], id) => ({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: input },
      })),
    );
    for (const [id, [name, input, where]] of cases.entries()) {
      const told = `${name} ${JSON.stringify(input)}`;
      expect(api[id]?.status, told).toBe(422);
      expect(`${api[id]?.body.path} ${api[id]?.body.error}`, told).toMatch(where);
      const served = answers.find((a) => a.id === id)?.result;
      expect(served?.isError, told).toBe(true);
      // refused at the same place, in the same words
      expect(served?.content?.[0]?.text, told).toBe(
        `The arguments are wrong at "${api[id]?.body.path}": ${api[id]?.body.error}`,
      );
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
    const lane = operator(repo, list, { FACTOR_LANE: "build" });
    expect(lane.status).not.toBe(0);
    expect(lane.answers).toEqual([]);
    // and the guard denies an agent the command, with or without the variable
    expect(operator(repo, list).status).toBe(0);
  });
});
