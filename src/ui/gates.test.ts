// A lane that ended in a failure shows the gate that failed first, rounds latest first; a lane that
// passed keeps its time order. What a gate checks is the gate's own description in the workflow.
import { expect, it } from "vitest";
import { failingGate, gateRounds, gateWhat } from "./gates.ts";

const gate = (name: string, status: string, attempt: number) =>
  ({
    gate: name,
    status,
    attempt,
    output: `${name}-${attempt}.log`,
    command: "",
    exitCode: 0,
    durationMs: 1,
  }) as never;
const rows = [
  gate("protected", "pass", 1),
  gate("floor", "fail", 1),
  gate("protected", "pass", 2),
  gate("tests", "pass", 2),
  gate("floor", "fail", 2),
];

it("puts the failing gate first and the latest round first, in a lane that failed", () => {
  const rounds = gateRounds({ outcome: "fail", gates: rows });
  expect(rounds.map((r) => r.round)).toEqual([2, 1]);
  expect(rounds[0]?.gates.map((g) => g.gate)).toEqual(["floor", "protected", "tests"]);
  expect(rounds[1]?.gates.map((g) => g.gate)).toEqual(["floor", "protected"]);
  expect(failingGate({ outcome: "fail", gates: rows })?.output).toBe("floor-2.log");
});

it("keeps the time order in one group when a lane passed, even after a repair", () => {
  const rounds = gateRounds({ outcome: "pass", gates: [gate("floor", "fail", 1), gate("floor", "pass", 2)] });
  expect(rounds).toHaveLength(1);
  expect(rounds[0]?.gates.map((g) => g.attempt)).toEqual([1, 2]);
  expect(failingGate({ outcome: "pass", gates: rows })).toBeUndefined();
});

it("has no failing gate when the lane failed for another reason", () => {
  expect(failingGate({ outcome: "fail", gates: [gate("protected", "pass", 1)] })).toBeUndefined();
});

it("takes what a gate checks from the workflow's own description of it", () => {
  const workflow = { gates: { floor: { description: "the number of tests must not go down" }, plain: {} } };
  expect(gateWhat(workflow, "floor")).toBe("the number of tests must not go down");
  expect(gateWhat(workflow, "plain")).toBeUndefined();
  expect(gateWhat(workflow, "missing")).toBeUndefined();
  expect(gateWhat(null, "floor")).toBeUndefined();
});
