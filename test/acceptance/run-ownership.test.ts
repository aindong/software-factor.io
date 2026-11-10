import { describe, expect, it } from "vitest";
import { agentLane, background, commandLane, flowRepo, pass, runRow, until } from "../helpers/repo.ts";

describe("one owner per run", () => {
  it("two processes started together each take a different task", async () => {
    const repo = flowRepo({ tasks: "- [ ] A\n- [ ] B\n", lanes: [commandLane("work", "sleep 1")] });
    repo.sf("collect");
    const [a, b] = [background(repo, "run"), background(repo, "run")];
    expect([await a.exit, await b.exit]).toEqual([0, 0]);
    const runs = repo.rows<{ task_id: number; status: string }>(
      "select task_id, status from runs order by task_id",
    );
    expect(runs).toEqual([
      { task_id: 1, status: "done" },
      { task_id: 2, status: "done" },
    ]);
  }, 30_000);

  it("a decision on a run that another process is working on is refused", async () => {
    const repo = flowRepo({
      lanes: [agentLane("work")],
      scripts: { author: { work: [{ sleep: 3000 }, pass()] } },
    });
    const run = background(repo, "run");
    expect(await until(() => repo.rows("select id from lane_runs").length === 1)).toBe(true);
    const r = repo.sf("approve", runRow(repo)?.id ?? "");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not waiting/);
    expect(await run.exit).toBe(0);
  }, 30_000);
});
