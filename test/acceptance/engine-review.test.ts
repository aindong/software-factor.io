import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentLane,
  commandLane,
  commitFile,
  fail,
  flowRepo,
  pass,
  type Repo,
  runRow,
  trail,
} from "../helpers/repo.ts";

// Found by the correctness review of the engine.
const MINUTE = 60_000;
const wait = (settings: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: "pause",
  uses: "core/wait@1",
  with: settings,
  checkpoint: "out",
  on: { pass: "@done", fail: "@stop" },
  ...extra,
});
const runs = (repo: Repo) =>
  repo.rows<{ status: string; stop_code: string; title: string }>(
    "select runs.status, runs.stop_code, tasks.title from runs join tasks on tasks.id = runs.task_id order by tasks.id",
  );

describe("waits and approvals together", () => {
  it("a wait that needs approval is approved once, then waits, then finishes", () => {
    const repo = flowRepo({
      lanes: [
        agentLane("build", { on: { pass: "pause", fail: "@stop" } }),
        wait({ minutes: 5 }, { checkpoint: "in" }),
      ],
    });
    expect(repo.sf("run").status).toBe(3);
    expect(runRow(repo)?.stop_code).toBe("awaiting_approval");
    expect(repo.sf("approve", runRow(repo)?.id ?? "").status).toBe(3);
    expect(runRow(repo)?.stop_code).toBe("waiting");
    repo.env.FACTOR_CLOCK_OFFSET_MS = String(6 * MINUTE);
    expect(repo.sf("run").status).toBe(0);
    expect(trail(repo)).toEqual(["build:pass", "pause:pass"]);
    expect(repo.rows("select status from inbox")).toEqual([{ status: "approved" }]);
  });
});

describe("an agent that asks for a person", () => {
  it("gets its question to the inbox: gates do not judge unfinished work", () => {
    const repo = flowRepo({
      commands: { verify: "test -f done.txt" },
      lanes: [agentLane("work", { agent: { access: "write" }, gates: ["verify"] })],
      scripts: {
        author: {
          work: [
            [{ handoff: { outcome: "needsPerson", summary: "Which database?" } }],
            [...commitFile("done.txt"), pass()],
          ],
        },
      },
    });
    expect(repo.sf("run").status).toBe(3);
    expect(runRow(repo)?.stop_code).toBe("needs_person");
    expect(repo.rows("select body from inbox")).toEqual([{ body: "Which database?" }]);
    expect(repo.rows("select id from gate_results")).toEqual([]);
    expect(repo.sf("answer", runRow(repo)?.id ?? "", "--note", "Postgres").status).toBe(0);
    expect(trail(repo)).toEqual(["work:needsPerson", "work:pass"]);
  });
});

describe("budgets and loops", () => {
  it("caps a lane's own minutes by what the run has left", () => {
    const repo = flowRepo({
      limits: { minutes: 2, tokens: 1000000 },
      lanes: [
        agentLane("a", { on: { pass: "b", fail: "@stop" } }),
        agentLane("b", { limits: { minutes: 2 } }),
      ],
      scripts: { author: { a: [{ sleep: 600 }, pass()], b: [{ sleep: 5000 }, pass()] } },
    });
    // a minute lasts one second: the run has 2 s, lane a uses about 0.7 s, so lane b has about 1.3 s
    // and not the 2 s its own limit allows
    repo.env.FACTOR_MINUTE_MS = "1000";
    expect(repo.sf("run").status).toBe(1);
    expect(trail(repo)).toEqual(["a:pass", "b:fail"]);
    expect(JSON.parse(runRow(repo)?.state ?? "{}").spent.ms).toBeLessThan(2450);
  });

  it("notices a round with no new commit even when two loops share the lane they go back to", () => {
    const back = [{ to: "build", maxRounds: 2 }, { to: "@stop" }];
    const repo = flowRepo({
      lanes: [
        agentLane("build", {
          agent: { access: "write" },
          gates: ["verify"],
          on: { pass: "review", fail: "@stop" },
        }),
        agentLane("review", { agent: { role: "reviewer" }, on: { pass: "audit", fail: back } }),
        agentLane("audit", { agent: { role: "reviewer" }, on: { pass: "@done", fail: back } }),
      ],
      scripts: {
        author: {
          build: [[...commitFile("a.txt"), pass()], [...commitFile("b.txt"), pass()], [pass()], [pass()]],
        },
        reviewer: { review: [[fail("x")], [pass()], [fail("x2")], [fail("x3")]], audit: [[fail("y")]] },
      },
    });
    expect(repo.sf("run").status).toBe(1);
    expect(runRow(repo)?.stop_code).toBe("no_progress");
    expect(trail(repo).filter((t) => t.startsWith("build"))).toHaveLength(3);
  });
});

describe("one call that moves several runs", () => {
  it("exits 1 when a woken run stopped, even if the next task then parked", () => {
    const repo = flowRepo({
      tasks: "- [ ] A\n- [ ] B\n",
      lanes: [wait({ minutes: 5 }, { on: { pass: "check", fail: "@stop" } }), commandLane("check", "false")],
    });
    expect(repo.sf("run").status).toBe(3);
    repo.env.FACTOR_CLOCK_OFFSET_MS = String(6 * MINUTE);
    expect(repo.sf("run").status).toBe(1);
    expect(runs(repo)).toEqual([
      { status: "stopped", stop_code: "lane_failed", title: "A" },
      { status: "waiting", stop_code: "waiting", title: "B" },
    ]);
  });

  it("an interrupt stops only the run that was moving: parked runs stay parked and queued tasks stay queued", async () => {
    const repo = flowRepo({
      tasks: "- [ ] A\n- [ ] B\n",
      lanes: [
        wait({ minutes: 5 }, { on: { pass: "slow", fail: "@stop" } }),
        agentLane("slow", { agent: { access: "write" }, gates: ["verify"] }),
      ],
      scripts: { author: { slow: [{ sleep: 4000 }, ...commitFile("a.txt"), pass()] } },
    });
    repo.sf("run");
    repo.sf("run");
    expect(runs(repo).map((r) => r.status)).toEqual(["waiting", "waiting"]);
    repo.write(".factor/tasks.md", "- [ ] A\n- [ ] B\n- [ ] C\n");

    const child = spawn(process.execPath, [join(process.cwd(), "src/cli.ts"), "run"], {
      cwd: repo.dir,
      env: { ...process.env, FACTOR_HOME: repo.home, FACTOR_CLOCK_OFFSET_MS: String(6 * MINUTE) },
      stdio: "ignore",
    });
    const slowStarted = () => repo.rows("select id from lane_runs where lane = 'slow'").length > 0;
    for (let i = 0; i < 100 && !slowStarted(); i++) await new Promise((r) => setTimeout(r, 100));
    expect(slowStarted(), "the woken run never reached its agent").toBe(true);
    child.kill("SIGINT");
    await new Promise((r) => child.on("exit", r));

    expect(runs(repo)).toEqual([
      { status: "stopped", stop_code: "interrupted", title: "A" },
      { status: "waiting", stop_code: "waiting", title: "B" },
    ]);
    expect(repo.rows("select title, status from tasks where title = 'C'")).toEqual([]);
    // the interrupted lane is not recorded as passed: only gates pass a lane
    expect(repo.rows("select outcome from lane_runs where lane = 'slow'")).toEqual([{ outcome: "fail" }]);
  }, 30_000);
});
