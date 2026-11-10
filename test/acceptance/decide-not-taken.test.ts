// From the correctness review of task 16: a decision its command did not take is never
// answered as taken, whatever the command printed and however it ended.
import { afterAll, describe, expect, it } from "vitest";
import { op } from "../helpers/operator.ts";
import {
  agentLane,
  commitFile,
  flowRepo,
  pass,
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
const itemOf = (repo: Repo) =>
  repo.rows<{ id: number }>("select id from inbox where status = 'open'")[0]?.id ?? 1;

describe("a decision the command did not take", () => {
  it("is refused in the command's words, also when they take more than one line", async () => {
    const repo = flowRepo({
      lanes: [agentLane("work", { agent: { access: "write" }, gates: ["verify"], checkpoint: "in" })],
      scripts: { author: { work: [[...commitFile("a.txt"), pass()]] } },
    });
    expect(repo.sf("run").status).toBe(3);
    const run = runRow(repo)?.id ?? "";
    // the workflow breaks while the run waits: the command refuses, on more than one line
    repo.write(".factor/workflows/starter.json", '{ "name": "starter" }\n');
    const cli = repo.sf("approve", run);
    expect(cli.status).toBe(1);
    expect(cli.stderr).toMatch(/has problems/);
    const ui = await startUi(repo);
    uis.push(ui);
    const api = await op<{ state?: string }>(ui, "inbox_decide", {
      run,
      item: itemOf(repo),
      decision: "approve",
    });
    expect(api.status, JSON.stringify(api.body)).toBe(409);
    expect(api.body.error).toMatch(/has problems/);
    expect(api.body.fix).toBeTruthy();
    expect(repo.rows("select status from inbox")).toEqual([{ status: "open" }]);
    expect(runRow(repo)?.status).toBe("waiting");
  }, 120_000);

  it("says how the run really stands when the command has ended: dropped is not done", async () => {
    const repo = flowRepo({
      lanes: [agentLane("work", { checkpoint: "in", on: { pass: "@done", fail: "@drop" } })],
    });
    expect(repo.sf("run").status).toBe(3);
    const ui = await startUi(repo);
    uis.push(ui);
    const run = runRow(repo)?.id ?? "";
    const api = await op<{ state: string; run?: string }>(ui, "inbox_decide", {
      run,
      item: itemOf(repo),
      decision: "reject",
    });
    expect(api.status).toBe(200);
    expect(await until(() => runRow(repo)?.status === "dropped", 8000)).toBe(true);
    expect(api.body.state === "going" || api.body.run === "dropped", JSON.stringify(api.body)).toBe(true);
  }, 120_000);
});
