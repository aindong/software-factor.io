import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLane, evidenceOf, flowRepo, pass, RUNNER, runRow, trail } from "../helpers/repo.ts";

const files = {
  "run-tests.sh": RUNNER,
  "t/one.test.sh": "test -f run-tests.sh\n",
  "t/two.test.sh": "true\n",
};
const flow = (o: {
  steps: unknown[] | unknown[][];
  verify?: string;
  gate?: Record<string, unknown>;
  limits?: Record<string, unknown>;
}) =>
  flowRepo({
    commands: { verify: o.verify ?? "sh run-tests.sh" },
    gates: { floor: { uses: "core/test-floor@1", onFail: "fail", ...o.gate } },
    lanes: [
      agentLane("build", {
        agent: { access: "write" },
        gates: ["floor"],
        ...(o.limits ? { limits: o.limits } : {}),
      }),
    ],
    scripts: { author: { build: o.steps } },
    files,
  });
const write = (path: string, content: string) => ({ write: { path, content } });
const commit = { commit: "change" };

describe("the test-floor gate", () => {
  it("passes when as many or more tests run", () => {
    const more = flow({ steps: [write("t/three.test.sh", "true\n"), commit, pass()] });
    expect(more.sf("run").status).toBe(0);
    expect(evidenceOf(more)[0]).toMatch(/3 tests.*base.*2/s);
    const same = flow({ steps: [write("src/a.txt", "a\n"), commit, pass()] });
    expect(same.sf("run").status).toBe(0);
  });

  it("fails when fewer tests run than on the base commit", () => {
    const repo = flow({ steps: [{ delete: "t/two.test.sh" }, commit, pass()] });
    expect(repo.sf("run").status).toBe(1);
    expect(repo.rows("select status from gate_results")).toEqual([{ status: "fail" }]);
    expect(evidenceOf(repo)[0]).toMatch(/1 test.*base.*2/s);
  });

  it("fails when no count can be read", () => {
    const repo = flow({ steps: [write("src/a.txt", "a\n"), commit, pass()], verify: "true" });
    expect(repo.sf("run").status).toBe(1);
    expect(evidenceOf(repo)[0]).toMatch(/could not read a test count/);
  });

  it("reads a runner it does not know with a pattern", () => {
    const repo = flow({
      steps: [write("src/a.txt", "a\n"), commit, pass()],
      verify: 'echo "ran 4 checks"',
      gate: { with: { pattern: "ran (\\d+) checks" } },
    });
    expect(repo.sf("run").status).toBe(0);
  });

  it("measures the base commit once per run, however often the gate runs", () => {
    const repo = flow({
      steps: [
        [{ delete: "t/two.test.sh" }, commit, pass()],
        [write("t/two.test.sh", "true\n"), commit, pass()],
      ],
      gate: { onFail: "repair" },
      limits: { repairRounds: 1 },
    });
    expect(repo.sf("run").status).toBe(0);
    expect(trail(repo)).toEqual(["build:pass"]);
    expect(repo.rows("select status from gate_results order by id")).toEqual([
      { status: "fail" },
      { status: "pass" },
    ]);
    const evidence = readdirSync(join(repo.dir, ".factor/runs", runRow(repo)?.id ?? "", "evidence"));
    expect(evidence.filter((f) => f.includes("base"))).toHaveLength(1);
  });
});
