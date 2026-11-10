import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLane, commandLane, commitFile, flowRepo, pass, runRow, trail } from "../helpers/repo.ts";

const build = [...commitFile("a.txt"), pass()];

describe("the setup command", () => {
  it("runs in a gate's checkout before the gate", () => {
    const repo = flowRepo({
      commands: { setup: "touch .setup-ran", verify: "test -f .setup-ran" },
      lanes: [agentLane("build", { agent: { access: "write" }, gates: ["verify"] })],
      scripts: { author: { build } },
    });
    expect(repo.sf("run").status).toBe(0);
  });

  it("runs once per checkout, not once per gate", () => {
    const repo = flowRepo({
      commands: { setup: 'echo ran >> "$COUNT_FILE"', verify: "true" },
      gates: {
        verify: { uses: "core/command@1", with: { command: "verify" }, onFail: "fail" },
        again: { uses: "core/command@1", with: { run: "true" }, onFail: "fail" },
      },
      lanes: [agentLane("build", { agent: { access: "write" }, gates: ["verify", "again"] })],
      scripts: { author: { build } },
      factory: { gateEnv: ["COUNT_FILE"] },
    });
    repo.env.COUNT_FILE = join(repo.home, "count.txt");
    expect(repo.sf("run").status).toBe(0);
    expect(readFileSync(repo.env.COUNT_FILE, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("fails the lane, with its output as evidence, when it fails", () => {
    const repo = flowRepo({
      commands: { setup: "echo boom; exit 7", verify: "true" },
      lanes: [agentLane("build", { agent: { access: "write" }, gates: ["verify"] })],
      scripts: { author: { build } },
    });
    expect(repo.sf("run").status).toBe(1);
    expect(trail(repo)).toEqual(["build:fail"]);
    expect(repo.rows<{ note: string }>("select note from lane_runs")[0]?.note).toMatch(/setup/);
    const [g] = repo.rows<{ gate: string; status: string; exit_code: number; output_path: string }>(
      "select * from gate_results",
    );
    expect(g).toMatchObject({ gate: "setup", status: "fail", exit_code: 7 });
    expect(readFileSync(join(repo.dir, g?.output_path ?? ""), "utf8")).toContain("boom");
  });
});

describe("a command lane with no gate", () => {
  const bump =
    "echo 2 > version.txt && git add version.txt && git -c user.name=t -c user.email=t@t commit -qm bump";

  it("fails when its command commits: nothing checks that commit", () => {
    const repo = flowRepo({ lanes: [commandLane("bump", bump)] });
    expect(repo.sf("run").status).toBe(1);
    expect(repo.rows<{ note: string }>("select note from lane_runs")[0]?.note).toMatch(/no gate/);
    expect(runRow(repo)?.stop_code).toBe("lane_failed");
  });

  it("passes with a gate on the lane", () => {
    const repo = flowRepo({
      gates: { verify: { uses: "core/command@1", with: { run: "test -f version.txt" }, onFail: "fail" } },
      lanes: [commandLane("bump", bump, { gates: ["verify"] })],
    });
    expect(repo.sf("run").status).toBe(0);
  });
});
