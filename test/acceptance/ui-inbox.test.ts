import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { op, tool } from "../helpers/operator.ts";
import {
  agentLane,
  commandLane,
  commitFile,
  flowRepo,
  pass,
  promptsOf,
  type Repo,
  runRow,
  startUi,
  type Ui,
  until,
} from "../helpers/repo.ts";

interface Item {
  run: string;
  task: string;
  lane: string;
  kind: string;
  body: string;
  decisions: string[];
}
const uis: Ui[] = [];
afterAll(async () => {
  for (const ui of uis) await ui.stop();
});
async function open(repo: Repo): Promise<Ui> {
  const ui = await startUi(repo);
  uis.push(ui);
  return ui;
}
/** A run that waits for approval of finished work. */
const finished = () => {
  const repo = flowRepo({
    lanes: [
      agentLane("work", { name: "Work", agent: { access: "write" }, gates: ["verify"], checkpoint: "in" }),
    ],
    scripts: {
      author: {
        work: [
          [...commitFile("a.txt"), pass()],
          [...commitFile("b.txt"), pass()],
        ],
      },
    },
  });
  if (repo.sf("run").status !== 3) throw new Error("the run should wait");
  return repo;
};
/** A run that waits before a command it has not run. */
const before = () => {
  const repo = flowRepo({
    lanes: [
      agentLane("build", { on: { pass: "ship", fail: "@stop" } }),
      commandLane("ship", 'touch "$SHIP_FLAG"', { checkpoint: "in" }),
    ],
    factory: { gateEnv: ["SHIP_FLAG"] },
  });
  repo.env.SHIP_FLAG = join(repo.home, "shipped");
  if (repo.sf("run").status !== 3) throw new Error("the run should wait");
  return repo;
};
/** A run whose lane asked a question. */
const asked = () => {
  const repo = flowRepo({
    lanes: [agentLane("plan")],
    scripts: {
      author: { plan: [[{ handoff: { outcome: "needsPerson", summary: "Which database?" } }], [pass()]] },
    },
  });
  if (repo.sf("run").status !== 3) throw new Error("the run should wait");
  return repo;
};
const items = async (ui: Ui) => (await op<{ items: Item[] }>(ui, "inbox_list")).body.items;
const ended = (repo: Repo, status: string) => until(() => runRow(repo)?.status === status, 8000);

describe("the inbox", () => {
  it("lists what waits, with the decisions each item takes", async () => {
    const [a, b, q] = [finished(), before(), asked()];
    expect(await items(await open(a))).toMatchObject([
      {
        run: runRow(a)?.id,
        task: "Do the thing",
        lane: "work",
        kind: "approval",
        decisions: ["approve", "reject", "send-back"],
      },
    ]);
    expect((await items(await open(b)))[0]).toMatchObject({
      lane: "ship",
      kind: "approval",
      decisions: ["approve", "reject"],
    });
    expect((await items(await open(q)))[0]).toMatchObject({
      lane: "plan",
      kind: "question",
      body: "Which database?",
      decisions: ["answer"],
    });
    expect(tool<{ items: Item[] }>(q, "inbox_list").data.items).toEqual(await items(await open(q)));
  }, 120_000);

  it("approve through the API: the run goes on in a process of its own, and the item leaves the list", async () => {
    const repo = finished();
    const ui = await open(repo);
    const run = runRow(repo)?.id ?? "";
    const { status, body } = await op<{ state: string }>(ui, "inbox_decide", { run, decision: "approve" });
    expect(status).toBe(200);
    expect(["ended", "going"]).toContain(body.state);
    expect(await ended(repo, "done")).toBe(true);
    expect(await items(ui)).toEqual([]);
    expect(repo.rows("select status from inbox")).toEqual([{ status: "approved" }]);
  }, 120_000);

  it("approve through the MCP server: a command that waited is run", async () => {
    const repo = before();
    const flag = join(repo.home, "shipped");
    expect(existsSync(flag)).toBe(false);
    const said = tool<{ state: string }>(repo, "inbox_decide", {
      run: runRow(repo)?.id,
      decision: "approve",
    });
    expect(said.refused, said.text).toBe(false);
    expect(await ended(repo, "done")).toBe(true);
    expect(existsSync(flag)).toBe(true);
  }, 120_000);

  it("reject and send back do what the command line's commands do", async () => {
    const sent = finished();
    const ui = await open(sent);
    const run = runRow(sent)?.id ?? "";
    // a note that looks like an option is still a note
    expect(
      (await op(ui, "inbox_decide", { run, decision: "send-back", note: "--all use tabs; $(touch x)" }))
        .status,
    ).toBe(200);
    expect(
      await until(() => promptsOf(sent, "work").length === 2 && runRow(sent)?.status === "waiting", 8000),
    ).toBe(true);
    expect(promptsOf(sent, "work")[1]).toContain("--all use tabs; $(touch x)");
    expect(existsSync(join(sent.dir, "x"))).toBe(false);
    expect((await op(ui, "inbox_decide", { run, decision: "reject", note: "wrong approach" })).status).toBe(
      200,
    );
    expect(await ended(sent, "stopped")).toBe(true);
    expect(runRow(sent)?.stop_code).toBe("rejected");
  }, 120_000);

  it("answer: the lane runs again with the answer", async () => {
    const repo = asked();
    const ui = await open(repo);
    const run = runRow(repo)?.id ?? "";
    expect((await op(ui, "inbox_decide", { run, decision: "answer", note: "Postgres" })).status).toBe(200);
    expect(await ended(repo, "done")).toBe(true);
    expect(promptsOf(repo, "plan")[1]).toContain("Postgres");
  }, 120_000);

  it("refuses what the command line refuses, in its words, and changes nothing", async () => {
    const repo = finished();
    const ui = await open(repo);
    const run = runRow(repo)?.id ?? "";
    const refused: [unknown, RegExp][] = [
      [{ run, decision: "send-back" }, /needs a note/],
      [{ run, decision: "send-back", note: "   " }, /needs a note/],
      [{ run, decision: "answer", note: "x" }, /waits for an approval, not an answer/],
      [{ run: "0000ffff", decision: "approve" }, /There is no run/],
    ];
    for (const [input, words] of refused) {
      const api = await op(ui, "inbox_decide", input);
      expect(api.status, JSON.stringify(input)).toBe(409);
      expect(api.body.error).toMatch(words);
      expect(api.body.fix, JSON.stringify(input)).toBeTruthy();
      const served = tool(repo, "inbox_decide", input);
      expect(served.refused).toBe(true);
      expect(served.text).toMatch(words);
    }
    expect(runRow(repo)?.status).toBe("waiting");
    expect(repo.rows("select status from inbox")).toEqual([{ status: "open" }]);
    // a run that is done takes no decision
    await op(ui, "inbox_decide", { run, decision: "approve" });
    await ended(repo, "done");
    const late = await op(ui, "inbox_decide", { run, decision: "approve" });
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/is not waiting for a person/);
  }, 120_000);

  it("takes one of two decisions given at the same moment", async () => {
    const repo = finished();
    const ui = await open(repo);
    const run = runRow(repo)?.id ?? "";
    const both = await Promise.all([
      op(ui, "inbox_decide", { run, decision: "approve" }),
      op(ui, "inbox_decide", { run, decision: "approve" }),
    ]);
    expect(both.map((b) => b.status).sort()).toEqual([200, 409]);
    expect(await ended(repo, "done")).toBe(true);
    expect(repo.rows("select lane, outcome from lane_runs")).toEqual([{ lane: "work", outcome: "pass" }]);
  }, 120_000);
});
