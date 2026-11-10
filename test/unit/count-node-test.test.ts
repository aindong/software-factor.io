// node's own test runner prints its summary in the "spec" form when it is not asked for another:
// the gate that counts tests must read it, or every project on `node --test` fails that gate.
import { expect, it } from "vitest";
import { countTests } from "../../src/core/gates/count.ts";

const spec = (pass: number, fail: number) =>
  `✔ adds (0.3ms)\nℹ tests ${pass + fail}\nℹ suites 0\nℹ pass ${pass}\nℹ fail ${fail}\nℹ cancelled 0\nℹ skipped 1\nℹ todo 0\nℹ duration_ms 49.3\n`;

it("counts the tests that passed and failed in node's spec summary, and not the skipped ones", () => {
  expect(countTests(spec(3, 0))).toBe(3);
  expect(countTests(spec(2, 1))).toBe(3);
  expect(countTests(spec(0, 0))).toBe(0);
});

it("adds up two summaries, as a project with two packages prints them", () => {
  expect(countTests(spec(3, 0) + spec(4, 1))).toBe(8);
});

it("still reads the TAP form of the same runner", () => {
  expect(countTests("# tests 2\n# pass 2\n# fail 0\n")).toBe(2);
});
