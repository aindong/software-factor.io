import { describe, expect, it } from "vitest";
import { agentLane, commitFile, flowRepo, pass, promptsOf, runRow, trail } from "../helpers/repo.ts";

const verify = 'test -f good.txt || { echo "good.txt is missing"; exit 1; }';
const repairFlow = (build: unknown) =>
  flowRepo({
    commands: { verify },
    gates: { verify: { uses: "core/command@1", with: { command: "verify" }, onFail: "repair" } },
    lanes: [
      agentLane("build", { agent: { access: "write" }, gates: ["verify"], limits: { repairRounds: 2 } }),
    ],
    scripts: { author: { build } },
  });

describe("a gate that sends work back for repair", () => {
  it("passes the lane once the repair passes the gate, in the same lane run", () => {
    const repo = repairFlow([
      [...commitFile("bad.txt"), pass()],
      [...commitFile("good.txt"), pass()],
    ]);
    expect(repo.sf("run").status).toBe(0);
    expect(trail(repo)).toEqual(["build:pass"]);
    expect(repo.rows("select status, attempt from gate_results order by id")).toEqual([
      { status: "fail", attempt: 1 },
      { status: "pass", attempt: 2 },
    ]);
    const prompts = promptsOf(repo, "build");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("good.txt is missing");
  });

  it("fails the lane when the repairs run out", () => {
    const repo = repairFlow([
      [...commitFile("bad.txt"), pass()],
      [...commitFile("worse.txt"), pass()],
      [pass()],
    ]);
    expect(repo.sf("run").status).toBe(1);
    expect(trail(repo)).toEqual(["build:fail"]);
    expect(repo.rows("select status from gate_results")).toHaveLength(3);
    expect(repo.rows<{ note: string }>("select note from lane_runs")[0]?.note).toMatch(/2 repairs/);
    expect(runRow(repo)).toMatchObject({ status: "stopped", stop_code: "lane_failed" });
  });
});

describe("an agent that crashes", () => {
  const flow = (retry: unknown) =>
    flowRepo({
      lanes: [
        agentLane("build", { agent: { access: "write" }, gates: ["verify"], ...(retry ? { retry } : {}) }),
      ],
      scripts: { author: { build: [[{ exit: 2 }], [...commitFile("a.txt"), pass()]] } },
    });

  it("is started again when the lane allows a retry", () => {
    const repo = flow({ max: 1 });
    expect(repo.sf("run").status).toBe(0);
    expect(trail(repo)).toEqual(["build:pass"]);
    expect(repo.rows("select attempts from lane_runs")).toEqual([{ attempts: 2 }]);
  });

  it("fails the lane when it does not", () => {
    const repo = flow(undefined);
    expect(repo.sf("run").status).toBe(1);
    expect(trail(repo)).toEqual(["build:fail"]);
  });
});
