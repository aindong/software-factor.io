import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeRepo, passingScript, readyRepo } from "../helpers/repo.ts";

// Found by the correctness review of the tracer bullet.
describe("nothing is left half done", () => {
  it("refuses a repository with no commit, and leaves the task queued", () => {
    const repo = makeRepo({ commit: false });
    expect(repo.sf("init").status).toBe(0);
    const run = repo.sf("run");
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/commit/);
    expect(run.stderr).not.toMatch(/\n\s+at /);
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "first");
    expect(repo.sf("collect").status).toBe(0);
    expect(repo.rows("select status from tasks")).toEqual([{ status: "queued" }]);
  });

  it("refuses a workflow whose prompt file is missing before it claims anything", () => {
    const repo = readyRepo({ verify: "true", script: passingScript });
    const workflow = repo.json<{ lanes: { agent: { prompt: unknown } }[] }>(".factor/workflows/starter.json");
    const lane = workflow.lanes[0];
    if (lane) lane.agent.prompt = { file: "missing.md" };
    repo.write(".factor/workflows/starter.json", `${JSON.stringify(workflow, null, 2)}\n`);
    const run = repo.sf("run");
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/missing\.md/);
    expect(repo.sf("status").stdout).not.toMatch(/stopped|running/);
  });

  it("closes the lane when the agent crashes the run", () => {
    const repo = readyRepo({ verify: "true", script: [{ write: { path: "../escape.txt", content: "" } }] });
    expect(repo.sf("run").status).toBe(1);
    expect(repo.rows("select outcome from lane_runs")).toEqual([{ outcome: "fail" }]);
    expect(repo.sf("status").stdout).not.toMatch(/work\s+running/);
  });

  it("fails the lane when a gate fails, even if the agent asked for a person", () => {
    const repo = readyRepo({
      verify: "false",
      script: [{ handoff: { outcome: "needsPerson", summary: "?" } }],
    });
    expect(repo.sf("run").status).toBe(1);
    expect(repo.rows("select outcome from lane_runs")).toEqual([{ outcome: "fail" }]);
  });

  it("stops cleanly when the command is interrupted while a gate runs", async () => {
    // a duration no other process uses, so a leftover from an earlier run cannot be mistaken for this one
    const nap = `sleep 297.${process.pid}${Date.now() % 100000}`;
    const repo = readyRepo({ verify: nap, script: passingScript });
    const child = spawn(process.execPath, [join(process.cwd(), "src/cli.ts"), "run"], {
      cwd: repo.dir,
      env: { ...process.env, FACTOR_HOME: repo.home },
      stdio: "ignore",
    });
    const gateRunning = () => spawnSync("pgrep", ["-f", nap]).status === 0;
    for (let i = 0; i < 100 && !gateRunning(); i++) await new Promise((r) => setTimeout(r, 100));
    expect(gateRunning(), "the gate never started").toBe(true);
    child.kill("SIGTERM");
    const code = await new Promise((r) => child.on("exit", r));
    expect(code).not.toBe(0);
    await new Promise((r) => setTimeout(r, 300));
    expect(gateRunning(), "the gate command is still running").toBe(false);
    expect(repo.rows("select status from runs")).toEqual([{ status: "stopped" }]);
    expect(repo.rows("select status from tasks")).toEqual([{ status: "stopped" }]);
    expect(repo.git("worktree", "list")).not.toMatch(/-gate-/);
  }, 30_000);
});

describe("the task list", () => {
  const collect = (tasks: string) => {
    const repo = makeRepo();
    repo.sf("init");
    repo.write(".factor/tasks.md", tasks);
    const r = repo.sf("collect");
    return {
      r,
      titles: repo.rows<{ title: string }>("select title from tasks order by id").map((t) => t.title),
    };
  };

  it("keeps two tasks whose titles differ only by punctuation", () => {
    expect(collect("- [ ] C++ build\n- [ ] C# build\n").titles).toEqual(["C++ build", "C# build"]);
  });

  it("keeps two tasks with no Latin letters at all", () => {
    expect(collect("- [ ] 修复登录\n- [ ] 添加测试\n").titles).toHaveLength(2);
  });

  it("ignores a box inside a code block", () => {
    expect(collect("```\n- [ ] example only\n```\n\n- [ ] real one\n").titles).toEqual(["real one"]);
  });
});

describe("the scripted agent", () => {
  it("cannot delete outside its worktree", () => {
    const repo = readyRepo({
      verify: "true",
      script: [{ delete: "../canary" }, { handoff: { outcome: "pass" } }],
    });
    // the worktree's parent folder is known only once a run exists, so make the canary beside every run
    const first = repo.sf("run");
    const [r] = repo.rows<{ worktree: string }>("select worktree from runs");
    const canary = join(dirname(r?.worktree ?? ""), "canary");
    mkdirSync(canary, { recursive: true });
    repo.write(".factor/tasks.md", "- [ ] second task\n");
    repo.sf("run");
    expect(existsSync(canary), `first run: ${first.stdout}`).toBe(true);
  });
});
