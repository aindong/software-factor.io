// The starter that `init` writes is a small real process: plan, build, review, test, ship. It is
// read as a stranger gets it, then run to the end on the scripted agent with two approvals.
import { describe, expect, it } from "vitest";
import { parseWorkflow } from "../../src/core/schema/parse.ts";
import { makeRepo, trail } from "../helpers/repo.ts";

type Json = Record<string, unknown>;

describe("the starter workflow", () => {
  const repo = makeRepo();
  expect(repo.sf("init").status).toBe(0);
  const text = repo.read(".factor/workflows/starter.json");
  const workflow = JSON.parse(text) as { lanes: Json[]; roles: Json; gates: Json; commands: Json };

  it("has five lanes in order, with the roles and checkpoints of the process", () => {
    const lanes = workflow.lanes.map((l) => ({
      id: l.id,
      uses: l.uses,
      role: (l.agent as Json | undefined)?.role,
      access: (l.agent as Json | undefined)?.access,
      checkpoint: l.checkpoint,
    }));
    expect(lanes).toEqual([
      { id: "plan", uses: "core/agent@1", role: "author", access: "read", checkpoint: "in" },
      { id: "build", uses: "core/agent@1", role: "author", access: "write", checkpoint: "near" },
      { id: "review", uses: "core/agent@1", role: "reviewer", access: "read", checkpoint: "near" },
      { id: "test", uses: "core/agent@1", role: "tester", access: "read", checkpoint: "near" },
      { id: "ship", uses: "core/command@1", role: undefined, access: undefined, checkpoint: "in" },
    ]);
    expect(Object.keys(workflow.roles)).toEqual(["author", "reviewer", "tester"]);
    expect(Object.keys(workflow.commands)).toEqual(["verify", "ship"]);
    expect((workflow.gates.verify as Json).onFail).toBe("repair");
    expect(workflow.lanes.find((l) => l.id === "review")?.on).toEqual({
      pass: "test",
      fail: [{ to: "build", maxRounds: 2 }, { to: "@stop" }],
    });
    expect(workflow.lanes.find((l) => l.id === "test")?.on).toEqual({
      pass: "ship",
      fail: [{ to: "build", maxRounds: 1 }, { to: "@stop" }],
    });
  });

  it("passes the checker and round-trips through the parser unchanged", () => {
    const r = repo.sf("check");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const parsed = parseWorkflow(JSON.parse(text));
    expect(parsed.problems).toEqual([]);
    expect(JSON.parse(JSON.stringify(parsed.workflow))).toEqual(JSON.parse(text));
  });

  it("holds no path of the machine", () => {
    const files = [text, repo.read(".factor/factory.json")].join("\n");
    expect(files).not.toMatch(/\/Volumes\/|\/Users\/|\/home\/[a-z]|\/private\/|\/tmp\//);
  });
});

describe("the first run", () => {
  const repo = makeRepo();
  expect(repo.sf("init").status).toBe(0);
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "a factory");
  const runId = () => repo.rows<{ id: string }>("select id from runs")[0]?.id ?? "";

  it("plans, waits for the plan, builds, reviews and tests, waits for the ship, then ships", () => {
    const first = repo.sf("run");
    expect(first.status, first.stdout + first.stderr).toBe(3);
    expect(trail(repo)).toEqual(["plan:pass"]);
    const second = repo.sf("approve", runId());
    expect(second.status, second.stdout + second.stderr).toBe(3);
    expect(trail(repo)).toEqual(["plan:pass", "build:pass", "review:pass", "test:pass"]);
    expect(repo.rows("select status from runs")).toEqual([{ status: "waiting" }]);
    const third = repo.sf("approve", runId());
    expect(third.status, third.stdout + third.stderr).toBe(0);
    expect(trail(repo)).toEqual(["plan:pass", "build:pass", "review:pass", "test:pass", "ship:pass"]);
    expect(repo.rows("select status from runs")).toEqual([{ status: "done" }]);
  });

  it("merged the hello file into the branch the project started on", () => {
    expect(repo.git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(repo.git("show", "main:FACTOR-HELLO.md")).toMatch(/^Hello/);
    expect(repo.git("log", "-1", "--format=%s", "main")).toMatch(/^Merge factor\/.*: Say hello/);
  });

  it("ran the three roles on the scripted agent, and only they", () => {
    const rows = repo.rows<{ lane: string; agent: string }>("select lane, agent from sessions order by id");
    expect(rows.map((s) => s.lane)).toEqual(["plan", "build", "review", "test"]);
    expect(new Set(rows.map((s) => s.agent))).toEqual(new Set(["fake"]));
  });
});
