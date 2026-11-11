// Requeueing is an operation of the table: the interface's API, the operator's MCP server and the
// command line do the same, and the help and docs/operations.md say what it does and refuses.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { OPERATIONS } from "../../src/core/operations.ts";
import { op, tool } from "../helpers/operator.ts";
import { agentLane, fail, flowRepo, startUi } from "../helpers/repo.ts";

const stoppedRepo = () => {
  const repo = flowRepo({ lanes: [agentLane("work")], scripts: { author: { work: [fail("no")] } } });
  repo.sf("run");
  return repo;
};
const runId = (repo: ReturnType<typeof stoppedRepo>) =>
  repo.rows<{ id: string }>("select id from runs")[0]?.id;
const task = (repo: ReturnType<typeof stoppedRepo>) =>
  repo.rows<{ status: string }>("select status from tasks")[0]?.status;

it("is in the operations table as a change, named by the command line's words", () => {
  expect(OPERATIONS.find((o) => o.name === "runs_requeue")).toMatchObject({
    changes: true,
    cli: [["requeue", "<run>"]],
  });
});

it("requeues through the API and through the operator's MCP server, and refuses as the command does", async () => {
  const repo = stoppedRepo();
  const run = runId(repo) ?? "";
  const ui = await startUi(repo);
  try {
    const wrong = await op(ui, "runs_requeue", { run: "--all" });
    expect(wrong.status).toBe(422);
    const unknown = await op<{ error: string; fix: string }>(ui, "runs_requeue", { run: "nosuchrun" });
    expect(unknown.status).toBe(409);
    expect(unknown.body.error).toMatch(/There is no run "nosuchrun"/);

    const moved = await op<{ said: string }>(ui, "runs_requeue", { run });
    expect(moved.status).toBe(200);
    expect(moved.body.said).toMatch(/requeued/);
    expect(task(repo)).toBe("queued");

    const again = await op<{ error: string }>(ui, "runs_requeue", { run });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already queued/);
  } finally {
    ui.stop();
  }
  // the operator's own agent: stopped again, then requeued by the tool
  repo.sf("run");
  expect(task(repo)).toBe("stopped");
  const told = tool<{ said: string }>(repo, "runs_requeue", { run });
  expect(told.refused, told.text).toBe(false);
  expect(told.data.said).toMatch(/requeued/);
  expect(task(repo)).toBe("queued");
  expect(tool(repo, "runs_requeue", { run }).refused).toBe(true);
}, 120_000);

it("is told in the help and in docs/operations.md, with what it refuses", () => {
  const help = readFileSync("src/core/help.ts", "utf8");
  expect(help).toMatch(/\n {2}requeue <run>\s+Put the task of a stopped or dropped run back in the queue/);

  const doc = readFileSync("docs/operations.md", "utf8");
  expect(doc).toMatch(/\| `runs_requeue` \| changes \| `softwarefactor requeue <run>` \|/);
  const at = doc.indexOf("\n## Putting a stopped task back in the queue");
  expect(at, "a section of its own").toBeGreaterThan(-1);
  const section = doc.slice(at + 1).split(/\n## /)[0] ?? "";
  for (const said of [
    "softwarefactor requeue <run>",
    "stopped",
    "dropped",
    "queued",
    "new branch",
    "still working",
    "waiting",
    "done",
    "already queued",
    "inside a run",
    "exit 1",
  ]) {
    expect(section, said).toContain(said);
  }
});
