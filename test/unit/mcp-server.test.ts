import { describe, expect, it } from "vitest";
import { agentLane, flowRepo, mcp } from "../helpers/repo.ts";

const repo = flowRepo({ lanes: [agentLane("build")] });
const lane = { run: "r1", lane: "build" };
const init = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {} },
};

describe("softwarefactor mcp", () => {
  it("answers initialize with its name, the protocol version it was asked for, and its tools", () => {
    const { answers } = mcp(repo, lane, [init, { jsonrpc: "2.0", method: "notifications/initialized" }]);
    expect(answers.length).toBe(1); // a notification gets no answer
    expect(answers[0]).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2025-06-18", serverInfo: { name: "factor" }, capabilities: { tools: {} } },
    });
  });

  it("lists its five tools, each with a schema for its input, and none that keeps a note", () => {
    const { answers } = mcp(repo, lane, [{ jsonrpc: "2.0", id: 2, method: "tools/list" }]);
    const tools = (answers[0]?.result?.tools ?? []) as {
      name: string;
      description: string;
      inputSchema: { type: string };
    }[];
    expect(tools.map((t) => t.name).sort()).toEqual([
      "ask_question",
      "evidence_attach",
      "handoff_write",
      "memory_note",
      "memory_read",
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it("answers a ping, and gives an error for a method or a tool it does not have", () => {
    const { answers } = mcp(repo, lane, [
      { jsonrpc: "2.0", id: 3, method: "ping" },
      { jsonrpc: "2.0", id: 4, method: "resources/list" },
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "memory_keep", arguments: {} } },
    ]);
    expect(answers[0]).toMatchObject({ id: 3, result: {} });
    expect(answers[1]?.error?.code).toBe(-32601);
    expect(answers[2]?.error?.code).toBe(-32602);
  });

  it("is not ended by a line that is not JSON, or by arguments of the wrong shape", () => {
    const { answers, status } = mcp(repo, lane, [
      "this is not json",
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "memory_note", arguments: { title: 5 } },
      },
      { jsonrpc: "2.0", id: 7, method: "ping" },
    ]);
    expect(answers[0]?.error?.code).toBe(-32700);
    expect(answers[1]?.result?.isError).toBe(true);
    expect(answers[2]).toMatchObject({ id: 7, result: {} });
    expect(status).toBe(0);
  });

  it("refuses to start without the run and the lane it serves", () => {
    const { status, stderr } = mcp(repo, { run: "", lane: "build" }, [init]);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/--run/);
  });
});
