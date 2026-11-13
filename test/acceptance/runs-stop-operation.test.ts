// Stopping a run is an operation of the table, as requeueing is: the interface's API (the page's Stop
// button), the operator's MCP server and the command line do the same. A lane's agent has no way to it.
import { expect, it } from "vitest";
import { FACTOR_TOOLS } from "../../src/core/agents/factor-tools.ts";
import { OPERATIONS } from "../../src/core/operations.ts";
import { op, tool } from "../helpers/operator.ts";
import { agentLane, commitFile, flowRepo, mcp, pass, startUi } from "../helpers/repo.ts";

const waiting = () => {
  const repo = flowRepo({
    lanes: [agentLane("work", { agent: { access: "write" }, gates: ["verify"], checkpoint: "in" })],
    scripts: { author: { work: [[...commitFile("a.txt"), pass()]] } },
  });
  if (repo.sf("run").status !== 3) throw new Error("the run should wait");
  return repo;
};
const status = (repo: ReturnType<typeof waiting>) =>
  repo.rows<{ status: string }>("select status from runs")[0]?.status;
const runOf = (repo: ReturnType<typeof waiting>) =>
  repo.rows<{ id: string }>("select id from runs")[0]?.id ?? "";

it("is in the operations table as a change, named by the command line's words", () => {
  expect(OPERATIONS.find((o) => o.name === "runs_stop")).toMatchObject({
    changes: true,
    cli: [["stop", "<run>"]],
  });
});

it("stops through the API as the command does, and refuses as it does", async () => {
  const repo = waiting();
  const run = runOf(repo);
  const ui = await startUi(repo);
  try {
    expect((await op(ui, "runs_stop", { run: "--all" })).status).toBe(422);
    const unknown = await op<{ error: string }>(ui, "runs_stop", { run: "nosuchrun" });
    expect(unknown.status).toBe(409);
    expect(unknown.body.error).toMatch(/There is no run "nosuchrun"/);

    const stopped = await op<{ said: string }>(ui, "runs_stop", { run });
    expect(stopped.status).toBe(200);
    expect(stopped.body.said).toMatch(/stopped/);
    expect(status(repo)).toBe("stopped");
    expect(repo.rows<{ status: string }>("select status from tasks")[0]?.status).toBe("stopped");

    const again = await op<{ error: string }>(ui, "runs_stop", { run });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already ended/);

    // no token, or a wrong one: nothing is stopped, whoever asks from this machine
    const bare = await fetch(`${ui.url}/api/op/runs_stop`, { method: "POST", body: JSON.stringify({ run }) });
    expect(bare.status).toBe(401);
  } finally {
    ui.stop();
  }
}, 120_000);

it("stops through the operator's MCP server", () => {
  const repo = waiting();
  const told = tool<{ said: string }>(repo, "runs_stop", { run: runOf(repo) });
  expect(told.refused, told.text).toBe(false);
  expect(status(repo)).toBe("stopped");
});

it("is not among the tools an agent inside a lane has", () => {
  const repo = waiting();
  expect(FACTOR_TOOLS).not.toContain("runs_stop");
  const { answers } = mcp(repo, { run: runOf(repo), lane: "work" }, [
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ]);
  const tools = (answers.find((a) => a.id === 2)?.result?.tools ?? []) as { name: string }[];
  expect(tools.map((t) => t.name)).not.toContain("runs_stop");
  const call = mcp(repo, { run: runOf(repo), lane: "work" }, [
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "runs_stop", arguments: { run: runOf(repo) } },
    },
  ]);
  expect(call.answers.find((a) => a.id === 3)?.result?.isError ?? true).toBe(true);
  expect(status(repo)).toBe("waiting");
});
