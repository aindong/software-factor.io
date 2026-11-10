import { describe, expect, it } from "vitest";
import { agentLane, evidenceOf, flowRepo, pass } from "../helpers/repo.ts";

const TEST = `import { expect, it } from "vitest";
it("adds", () => {
  expect(1 + 1).toBe(2);
});
it("subtracts", () => {
  expect(2 - 1).toBe(1);
});
`;
const flow = (steps: unknown[]) =>
  flowRepo({
    gates: { kept: { uses: "core/tests-not-weakened@1", onFail: "fail" } },
    lanes: [agentLane("build", { agent: { access: "write" }, gates: ["kept"] })],
    scripts: { author: { build: [...steps, { commit: "change" }, pass()] } },
    files: {
      "src/math.test.js": TEST,
      "src/math.js": "export const add = (a, b) => a + b;\n",
      "package.json": '{"scripts":{"test":"vitest run"}}\n',
    },
  });
const write = (path: string, content: string) => ({ write: { path, content } });

describe("the tests-not-weakened gate", () => {
  it.each([
    ["deletes a test file", [{ delete: "src/math.test.js" }], /deleted/],
    [
      "removes a test",
      [write("src/math.test.js", TEST.replace(/it\("subtracts"[\s\S]*$/, ""))],
      /fewer tests/,
    ],
    ["skips a test", [write("src/math.test.js", TEST.replace('it("adds"', 'it.skip("adds"'))], /skip/],
    [
      "changes an assertion without adding a test",
      [write("src/math.test.js", TEST.replace("toBe(2)", "toBeDefined()"))],
      /assertion/,
    ],
    [
      "changes the test script",
      [write("package.json", '{"scripts":{"test":"true"}}\n')],
      /script "test" changed/,
    ],
  ])("fails a change that %s", (_name, steps, says) => {
    const repo = flow(steps as unknown[]);
    expect(repo.sf("run").status).toBe(1);
    expect(repo.rows("select status from gate_results")).toEqual([{ status: "fail" }]);
    expect(evidenceOf(repo)[0]).toMatch(says);
  });

  it.each([
    [
      "adds a test",
      [write("src/math.test.js", `${TEST}it("multiplies", () => {\n  expect(2 * 2).toBe(4);\n});\n`)],
    ],
    ["adds a new test file", [write("src/other.test.js", TEST)]],
    ["touches no test", [write("src/math.js", "export const add = (a, b) => b + a;\n")]],
    [
      "adds a script without changing the test script",
      [write("package.json", '{"scripts":{"test":"vitest run","docs":"typedoc"}}\n')],
    ],
  ])("passes a change that %s", (_name, steps) => {
    const repo = flow(steps as unknown[]);
    expect(repo.sf("run").status).toBe(0);
    expect(repo.rows("select status from gate_results")).toEqual([{ status: "pass" }]);
  });
});
