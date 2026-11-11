import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { planMessage, planProblems } from "../../src/core/gates/plan-contract.ts";

const root = mkdtempSync(join(tmpdir(), "sf-plan-example-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
writeFileSync(join(root, "a.test.js"), "// a test\n");

/** The message of the gate for the plan text, as the gate builds it from the plan check. */
function messageOf(plan: string): string {
  writeFileSync(join(root, "plan.md"), plan);
  return planMessage(planProblems(root, "plan.md"), "plan.md");
}
const GOOD =
  "# P\n\n## Acceptance criteria\n\n1. It adds.\n\n## Verification contract\n\n- 1: test:a.test.js\n";
const BAD = "# P\n\n## Acceptance criteria\n\n1. It adds.\n\n## Verification contract\n\n- 1: later\n";

describe("the plan check message", () => {
  it("ends a failing plan's message with a valid example of three lines at most", () => {
    const text = messageOf(BAD);
    expect(text).toMatch(/^The plan has 1 problem:/);
    const tail = text.trimEnd().split("\n").slice(-3);
    expect(tail[0]).toBe("## Verification contract");
    for (const line of tail.slice(1)) expect(line).toMatch(/^- \d+: (test|cmd|ui|human):\S/);
    // the line before the example is not part of it, and the example is not longer than three lines
    expect(text.trimEnd().split("\n").at(-4)).not.toMatch(/^(## |- \d+:)/);
  });

  it("gives the example for every kind of problem, such as a missing heading", () => {
    expect(messageOf("# P\n\n1. It adds.\n")).toMatch(
      /\n## Verification contract\n- 1: test:\S+\n- 2: cmd:.+\n$/,
    );
  });

  it("leaves the example out of a passing plan's message", () => {
    const text = messageOf(GOOD);
    expect(text).toBe('The plan "plan.md" gives each acceptance criterion one check.\n');
    expect(text).not.toMatch(/## Verification contract|- 1: test:/);
  });
});
