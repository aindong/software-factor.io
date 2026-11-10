import { describe, expect, it } from "vitest";
import { agentLane, evidenceOf, flowRepo, pass, RUNNER } from "../helpers/repo.ts";

const flow = (steps: unknown[]) =>
  flowRepo({
    commands: { verify: "sh run-tests.sh" },
    gates: { proves: { uses: "core/new-tests-fail-on-base@1", onFail: "fail" } },
    lanes: [agentLane("build", { agent: { access: "write" }, gates: ["proves"] })],
    scripts: { author: { build: [...steps, { commit: "change" }, pass()] } },
    files: { "run-tests.sh": RUNNER, "t/one.test.sh": "true\n" },
  });
const write = (path: string, content: string) => ({ write: { path, content } });

describe("the new-tests-fail-on-base gate", () => {
  it("passes when the new test fails without the change", () => {
    const repo = flow([write("feature.txt", "x\n"), write("t/feature.test.sh", "test -f feature.txt\n")]);
    expect(repo.sf("run").status).toBe(0);
    expect(evidenceOf(repo)[0]).toMatch(/t\/feature\.test\.sh/);
  });

  it("fails when the new test also passes without the change", () => {
    const repo = flow([write("feature.txt", "x\n"), write("t/lazy.test.sh", "true\n")]);
    expect(repo.sf("run").status).toBe(1);
    expect(repo.rows("select status from gate_results")).toEqual([{ status: "fail" }]);
    expect(evidenceOf(repo)[0]).toMatch(/pass without the change/);
  });

  it("passes, and says so, when there are no new tests", () => {
    const repo = flow([write("feature.txt", "x\n")]);
    expect(repo.sf("run").status).toBe(0);
    expect(evidenceOf(repo)[0]).toMatch(/no new tests/);
  });
});
