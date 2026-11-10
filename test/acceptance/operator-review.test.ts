// From the security review of task 16: what an agent's text and a stale view can do through
// the operations.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { op, operator, tool } from "../helpers/operator.ts";
import {
  agentLane,
  commandLane,
  flowRepo,
  type Repo,
  runRow,
  startUi,
  type Ui,
  until,
} from "../helpers/repo.ts";

const uis: Ui[] = [];
afterAll(async () => {
  for (const ui of uis) await ui.stop();
});
async function open(repo: Repo): Promise<Ui> {
  const ui = await startUi(repo);
  uis.push(ui);
  return ui;
}
const twoCheckpoints = () => {
  const repo = flowRepo({
    lanes: [
      agentLane("work", { checkpoint: "in", on: { pass: "ship", fail: "@stop" } }),
      commandLane("ship", "true", { checkpoint: "in" }),
    ],
  });
  repo.sf("run");
  return repo;
};
const openItem = (repo: Repo) =>
  repo.rows<{ id: number; lane: string }>("select id, lane from inbox where status = 'open'")[0];

describe("the operator server and text an agent wrote", () => {
  it("says which tools hand back an agent's words, and that they are not instructions", () => {
    const repo = flowRepo({ lanes: [agentLane("plan")] });
    const { answers } = operator(repo, [{ jsonrpc: "2.0", id: 1, method: "tools/list" }]);
    const tools = (answers.find((a) => a.id === 1)?.result?.tools ?? []) as {
      name: string;
      description: string;
    }[];
    for (const name of ["inbox_list", "runs_list", "runs_get", "runs_file", "runs_diff"]) {
      const description = tools.find((t) => t.name === name)?.description ?? "";
      expect(description, name).toMatch(/agent/i);
      expect(description, name).toMatch(/not instructions/i);
    }
    // and the tool that decides says whose decision it is
    expect(tools.find((t) => t.name === "inbox_decide")?.description).toMatch(/only when the person/i);
  }, 60_000);
});

describe("a decision names the item it was made on", () => {
  it("the same approval sent twice does not pass the next checkpoint", async () => {
    const repo = twoCheckpoints();
    const ui = await open(repo);
    const run = runRow(repo)?.id ?? "";
    const [seen] = (await op<{ items: { id: number }[] }>(ui, "inbox_list")).body.items;
    const first = await op(ui, "inbox_decide", { run, item: seen?.id, decision: "approve" });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(await until(() => openItem(repo)?.lane === "ship", 8000)).toBe(true);
    // the key pressed again, on the view the person had: the ship checkpoint was never shown
    const again = await op(ui, "inbox_decide", { run, item: seen?.id, decision: "approve" });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/no longer waits/);
    expect(again.body.fix).toBeTruthy();
    expect(runRow(repo)?.status).toBe("waiting");
    expect(openItem(repo)?.lane).toBe("ship");
    // through the MCP server too
    expect(tool(repo, "inbox_decide", { run, item: seen?.id, decision: "approve" }).refused).toBe(true);
    expect(tool(repo, "inbox_decide", { run, item: openItem(repo)?.id, decision: "approve" }).refused).toBe(
      false,
    );
    expect(await until(() => runRow(repo)?.status === "done", 8000)).toBe(true);
  }, 120_000);

  it("is needed: a decision that names no item is not taken", async () => {
    const repo = twoCheckpoints();
    const ui = await open(repo);
    const none = await op(ui, "inbox_decide", { run: runRow(repo)?.id, decision: "approve" });
    expect(none.status).toBe(422);
    expect(none.body.path).toBe("item");
    for (const item of [-1, 1.5, "1", 0]) {
      expect(
        (await op(ui, "inbox_decide", { run: runRow(repo)?.id, item, decision: "approve" })).status,
        String(item),
      ).toBe(422);
    }
    expect(runRow(repo)?.status).toBe("waiting");
  }, 120_000);

  it("on the command line the item is optional, and refused when it is not the one that waits", () => {
    const repo = twoCheckpoints();
    const run = runRow(repo)?.id ?? "";
    const wrong = repo.sf("approve", run, "--item", "999");
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toMatch(/no longer waits/);
    expect(repo.sf("approve", run, "--item", String(openItem(repo)?.id)).status).toBe(3);
    expect(repo.sf("approve", run).status).toBe(0);
  }, 120_000);
});

describe("the record of a decision", () => {
  it("refuses a note the command line cannot carry, and leaves nothing open behind", async () => {
    const repo = twoCheckpoints();
    const ui = await open(repo);
    const input = { run: runRow(repo)?.id, item: openItem(repo)?.id, decision: "reject", note: "a\u0000b" };
    for (let i = 0; i < 3; i++) expect((await op(ui, "inbox_decide", input)).status).toBe(422);
    expect((await op(ui, "inbox_decide", { ...input, note: "x".repeat(20_001) })).status).toBe(422);
    expect(runRow(repo)?.status).toBe("waiting");
  }, 120_000);

  it("is kept outside the folders agents work in, for the owner only", async () => {
    const repo = twoCheckpoints();
    const ui = await open(repo);
    await op(ui, "inbox_decide", { run: runRow(repo)?.id, item: openItem(repo)?.id, decision: "approve" });
    await until(() => openItem(repo)?.lane === "ship", 8000);
    const work = join(repo.home, "work");
    const inWork = readdirSync(work).flatMap((ws) => readdirSync(join(work, ws)));
    expect(inWork).not.toContain("decisions");
    const folder = join(repo.home, "decisions");
    expect(existsSync(folder)).toBe(true);
    const [ws = ""] = readdirSync(folder);
    expect(statSync(join(folder, ws)).mode & 0o077).toBe(0);
    const logs = readdirSync(join(folder, ws));
    expect(logs.length).toBe(1);
    expect(statSync(join(folder, ws, logs[0] ?? "")).mode & 0o077).toBe(0);
  }, 120_000);

  it("the operator server does not serve a run's own worktree as a workspace", () => {
    const repo = twoCheckpoints();
    const work = join(repo.home, "work");
    const ws = readdirSync(work)[0] ?? "";
    const worktree = readdirSync(join(work, ws)).find((f) => !f.endsWith(".out")) ?? "";
    expect(
      existsSync(join(work, ws, worktree, ".factor", "factory.json")),
      "the worktree has the factory's files",
    ).toBe(true);
    const list = [{ jsonrpc: "2.0", id: 1, method: "tools/list" }];
    const r = require("node:child_process").spawnSync(
      process.execPath,
      ["src/cli.ts", "mcp", "--operator", "--workspace", join(work, ws, worktree)],
      {
        input: `${JSON.stringify(list[0])}\n`,
        encoding: "utf8",
        env: { ...process.env, FACTOR_HOME: repo.home },
      },
    );
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/worktree of a run/);
  }, 120_000);
});
