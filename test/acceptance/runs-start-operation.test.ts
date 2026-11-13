// Starting a queued task is an operation of the table, as stopping is: the interface's API (the Floor's
// button), the operator's MCP server and the command line (`run --task`) do the same, within the slots.
// A lane's agent has no way to it, and the queue is read by the run list the Floor is built on.
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { FACTOR_TOOLS } from "../../src/core/agents/factor-tools.ts";
import { OPERATIONS } from "../../src/core/operations.ts";
import { op, tool } from "../helpers/operator.ts";
import { agentLane, flowRepo, mcp, startUi } from "../helpers/repo.ts";

const queued = () => {
  const repo = flowRepo({ lanes: [agentLane("work")], tasks: "- [ ] First thing\n- [ ] Second thing\n" });
  if (repo.sf("collect").status !== 0) throw new Error("collect failed");
  return repo;
};
type R = ReturnType<typeof queued>;
const statuses = (repo: R) =>
  repo.rows<{ title: string; status: string }>("select title, status from tasks order by id");
const keyOf = (repo: R, title: string) =>
  repo.rows<{ key: string }>(`select key from tasks where title = '${title}'`)[0]?.key ?? "";

it("is in the operations table as a change, named by the command line's words", () => {
  expect(OPERATIONS.find((o) => o.name === "runs_start")).toMatchObject({
    changes: true,
    cli: [["run", "--task", "<task>"]],
  });
});

it("lists the queued tasks with the run list", async () => {
  const repo = queued();
  const ui = await startUi(repo);
  try {
    const listed = await op<{ queued: { key: string; title: string }[] }>(ui, "runs_list");
    expect(listed.body.queued.map((t) => t.title)).toEqual(["First thing", "Second thing"]);
    expect(listed.body.queued[0]?.key).toBe(keyOf(repo, "First thing"));
  } finally {
    ui.stop();
  }
}, 120_000);

it("starts the one task named, as the command does, and refuses in plain words", async () => {
  const repo = queued();
  const ui = await startUi(repo);
  try {
    expect((await op(ui, "runs_start", { task: "" })).status).toBe(422);
    const none = await op<{ error: string }>(ui, "runs_start", { task: "no such thing" });
    expect(none.status).toBe(409);
    expect(none.body.error).toMatch(/No queued task has the key or the words/);

    // every slot taken: nothing starts, and the answer says why
    const db = new DatabaseSync(join(repo.dir, ".factor/state.db"));
    db.prepare("insert into slots (slot, run_id) values (1, 'busy1'), (2, 'busy2')").run();
    const full = await op<{ error: string; fix: string }>(ui, "runs_start", { task: "Second" });
    expect(full.status).toBe(409);
    expect(full.body.error).toMatch(/Every slot is busy \(2 in all\)/);
    expect(statuses(repo).map((t) => t.status)).toEqual(["queued", "queued"]);
    db.prepare("delete from slots").run();
    db.close();

    const started = await op<{ said: string }>(ui, "runs_start", { task: "Second" });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body.said).toMatch(/Second thing/);
    expect(statuses(repo)[1]?.status).not.toBe("queued");
    expect(statuses(repo)[0]?.status).toBe("queued");

    const bare = await fetch(`${ui.url}/api/op/runs_start`, { method: "POST", body: '{"task":"First"}' });
    expect(bare.status).toBe(401);
    expect(statuses(repo)[0]?.status).toBe("queued");
  } finally {
    ui.stop();
  }
}, 120_000);

it("starts through the operator's MCP server", () => {
  const repo = queued();
  const told = tool<{ said: string }>(repo, "runs_start", { task: keyOf(repo, "First thing") });
  expect(told.refused, told.text).toBe(false);
  expect(statuses(repo)[0]?.status).not.toBe("queued");
}, 120_000);

it("is not among the tools an agent inside a lane has", () => {
  const repo = queued();
  expect(FACTOR_TOOLS).not.toContain("runs_start");
  const as = { run: "r1", lane: "work" };
  const { answers } = mcp(repo, as, [{ jsonrpc: "2.0", id: 2, method: "tools/list" }]);
  const tools = (answers.find((a) => a.id === 2)?.result?.tools ?? []) as { name: string }[];
  expect(tools.map((t) => t.name)).not.toContain("runs_start");
  const call = mcp(repo, as, [
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "runs_start", arguments: { task: "First" } },
    },
  ]);
  expect(call.answers.find((a) => a.id === 3)?.result?.isError ?? true).toBe(true);
  expect(statuses(repo).map((t) => t.status)).toEqual(["queued", "queued"]);
});
