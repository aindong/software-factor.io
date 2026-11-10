import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { op as call, tool as serve } from "../helpers/operator.ts";
import {
  agentLane,
  background,
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
const repoOf = new Map<Ui, Repo>();
async function open(repo: Repo): Promise<Ui> {
  const ui = await startUi(repo);
  uis.push(ui);
  repoOf.set(ui, repo);
  return ui;
}
/** A decision names the item it is made on: here, the one that is open for the run. */
function named(repo: Repo | undefined, name: string, input: unknown): unknown {
  const given = input as { run?: string; item?: number };
  if (name !== "inbox_decide" || !repo || given.item !== undefined) return input;
  const open = repo.rows<{ id: number }>(
    `select id from inbox where status = 'open' and run_id = '${given.run}'`,
  )[0];
  return { ...given, item: open?.id ?? 1 };
}
const op = <T = Record<string, unknown>>(ui: Ui, name: string, input: unknown = {}) =>
  call<T>(ui, name, named(repoOf.get(ui), name, input));
const tool = <T = Record<string, unknown>>(repo: Repo, name: string, input: unknown = {}) =>
  serve<T>(repo, name, named(repo, name, input));
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
const unrun = () => {
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
    const [a, b, q] = [finished(), unrun(), asked()];
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
    const { status, body } = await op<{ state: string; run?: string }>(ui, "inbox_decide", {
      run,
      decision: "approve",
    });
    expect(status).toBe(200);
    // either the command had ended when the answer was made, and it says how, or the run was going on
    expect(
      body.state === "going" || (body.state === "ended" && body.run === "done"),
      JSON.stringify(body),
    ).toBe(true);
    expect(await ended(repo, "done")).toBe(true);
    expect(await items(ui)).toEqual([]);
    expect(repo.rows("select status from inbox")).toEqual([{ status: "approved" }]);
  }, 120_000);

  it("approve through the MCP server: a command that waited is run", async () => {
    const repo = unrun();
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

  it("refuses in the very words and fix of the command line", async () => {
    const [mine, twin] = [finished(), finished()];
    const ui = await open(mine);
    const cases: [string, string[]][] = [
      ["send-back", []],
      ["answer", ["--note", "x"]],
    ];
    for (const [decision, flags] of cases) {
      const said = twin
        .sf(decision, runRow(twin)?.id ?? "", ...flags)
        .stderr.replaceAll(runRow(twin)?.id ?? "", "RUN");
      const [, error = "", fix = ""] = /^error: (.*)\n {2}fix: (.*)$/m.exec(said) ?? [];
      const api = await op(ui, "inbox_decide", {
        run: runRow(mine)?.id,
        decision,
        ...(flags[1] ? { note: flags[1] } : {}),
      });
      expect(api.body.error?.replaceAll(runRow(mine)?.id ?? "", "RUN")).toBe(error);
      expect(api.body.fix).toBe(fix);
      expect(error.length * fix.length).toBeGreaterThan(0);
    }
    // approve to a question, and work sent back that has not been done
    const q = asked();
    const refusedQ = await op(await open(q), "inbox_decide", { run: runRow(q)?.id, decision: "approve" });
    expect(refusedQ.status).toBe(409);
    expect(refusedQ.body.error).toMatch(/asked a question/);
    const b = unrun();
    const refusedB = await op(await open(b), "inbox_decide", {
      run: runRow(b)?.id,
      decision: "send-back",
      note: "again",
    });
    expect(refusedB.status).toBe(409);
    expect(refusedB.body.error).toMatch(/has not run yet/);
    for (const repo of [q, b]) expect(runRow(repo)?.status).toBe("waiting");
  }, 120_000);

  it("leaves the record as the command line's own command leaves it", async () => {
    const [mine, twin] = [finished(), finished()];
    const ui = await open(mine);
    await op(ui, "inbox_decide", { run: runRow(mine)?.id, decision: "send-back", note: "use tabs" });
    twin.sf("send-back", runRow(twin)?.id ?? "", "--note", "use tabs");
    await until(() => runRow(mine)?.status === "waiting" && promptsOf(mine, "work").length === 2, 8000);
    await op(ui, "inbox_decide", { run: runRow(mine)?.id, decision: "approve" });
    twin.sf("approve", runRow(twin)?.id ?? "");
    await ended(mine, "done");
    const record = (repo: Repo) => ({
      run: repo.rows("select status, stop_code from runs"),
      lanes: repo.rows("select lane, outcome from lane_runs order by id"),
      inbox: repo.rows("select kind, status, answer from inbox order by id"),
      task: repo.rows("select status from tasks"),
    });
    expect(record(mine)).toEqual(record(twin));
  }, 120_000);

  it("says how a run ended at once: waiting again at the next checkpoint", async () => {
    const repo = flowRepo({
      lanes: [
        agentLane("work", { checkpoint: "in", on: { pass: "ship", fail: "@stop" } }),
        commandLane("ship", "true", { checkpoint: "in" }),
      ],
    });
    repo.sf("run");
    const ui = await open(repo);
    const run = runRow(repo)?.id ?? "";
    await op(ui, "inbox_decide", { run, decision: "approve" });
    expect(
      await until(
        () => repo.rows("select 1 from inbox where status = 'open' and lane = 'ship'").length === 1,
        8000,
      ),
    ).toBe(true);
    expect((await items(ui))[0]).toMatchObject({ run, lane: "ship", decisions: ["approve", "reject"] });
    const last = await op<{ state: string; run?: string }>(ui, "inbox_decide", { run, decision: "reject" });
    expect(last.status).toBe(200); // a run that stops is not a refusal
    expect(
      last.body.state === "going" || (last.body.state === "ended" && last.body.run === "stopped"),
      JSON.stringify(last.body),
    ).toBe(true);
    expect(await ended(repo, "stopped")).toBe(true);
  }, 120_000);

  it("answers at once when the run goes on for long, and the run outlives the interface", async () => {
    const repo = flowRepo({
      lanes: [
        agentLane("work", { checkpoint: "in", on: { pass: "slow", fail: "@stop" } }),
        commandLane("slow", "sleep 4"),
      ],
    });
    repo.sf("run");
    const ui = await startUi(repo);
    repoOf.set(ui, repo);
    const asked = Date.now();
    const { status, body } = await op<{ state: string }>(ui, "inbox_decide", {
      run: runRow(repo)?.id,
      decision: "approve",
    });
    expect(Date.now() - asked).toBeLessThan(3000);
    expect(status).toBe(200);
    expect(body.state).toBe("going");
    await ui.stop();
    expect(runRow(repo)?.status).toBe("running");
    expect(await until(() => runRow(repo)?.status === "done", 15_000)).toBe(true);
  }, 120_000);

  it("refuses when every slot is busy, and leaves every row of the record as it was", async () => {
    const repo = flowRepo({
      tasks: "- [ ] Wait here\n- [ ] Hold the slot\n",
      lanes: [
        commandLane("sort", "true", { on: { pass: "work", fail: "@stop" } }),
        agentLane("work", { checkpoint: "in" }),
      ],
      factory: { slots: { max: 1 } },
    });
    expect(repo.sf("run").status).toBe(3);
    const waitingRun = runRow(repo)?.id ?? "";
    // the second task holds the only slot: its first lane is made to take long
    repo.write(
      ".factor/workflows/starter.json",
      repo.read(".factor/workflows/starter.json").replace('"run": "true"', '"run": "sleep 5"'),
    );
    repo.git("commit", "-qam", "the first lane takes long");
    const busy = background(repo, "run");
    expect(
      await until(() => repo.rows("select 1 from runs where status = 'running'").length === 1, 8000),
    ).toBe(true);
    const record = () => ({
      run: repo.rows(`select * from runs where id = '${waitingRun}'`),
      lanes: repo.rows(`select * from lane_runs where run_id = '${waitingRun}'`),
      inbox: repo.rows("select * from inbox"),
      task: repo.rows("select * from tasks where id = 1"),
    });
    const before = record();
    const ui = await open(repo);
    const refused = await op(ui, "inbox_decide", { run: waitingRun, decision: "approve" });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/Every slot is busy/);
    expect(refused.body.fix).toMatch(/Decide again/);
    expect(record()).toEqual(before);
    busy.child.kill("SIGTERM");
    await busy.exit;
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
