import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { planProblems } from "../../src/core/gates/plan-contract.ts";

const root = mkdtempSync(join(tmpdir(), "sf-plan-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
for (const f of ["a.test.js", "b.test.js"]) writeFileSync(join(root, f), "// a test\n");

/** A plan file in the checkout, and what the gate says of it. */
function check(plan: string, path = "docs/plan.md"): string[] {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), plan);
  return planProblems(root, path);
}
const plan = (criteria: string, contract: string) =>
  `# Plan\n\n## Acceptance criteria\n\n${criteria}\n\n## Verification contract\n\n${contract}\n`;
const TWO = "1. It adds.\n2. It shows.";

describe("the plan check", () => {
  it("passes a plan whose every criterion has one check", () => {
    const text = plan(TWO, "- 1: test:a.test.js\n- 2: ui:the page shows the sum");
    expect(check(text)).toEqual([]);
  });

  it("accepts every kind, and a test path followed by a test name", () => {
    const contract = "- 1: test:a.test.js adds two\n- 2: cmd:pnpm run lint\n";
    expect(check(plan(`${TWO}\n3. Ok.\n4. Fine.`, `${contract}- 3: ui:x\n- 4: human:read it`))).toEqual([]);
  });

  it("names a criterion that has no check", () => {
    const problems = check(plan(TWO, "- 1: test:a.test.js"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Criterion 2 has no line in the verification contract/);
  });

  it("names a criterion that has two checks", () => {
    const problems = check(plan(TWO, "- 1: test:a.test.js\n- 1: cmd:true\n- 2: ui:x"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Criterion 1 has 2 lines/);
  });

  it("names a check for a number that is no criterion", () => {
    const problems = check(plan(TWO, "- 1: test:a.test.js\n- 2: ui:x\n- 7: cmd:true"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/"- 7: cmd:true" names criterion 7, which the plan does not have/);
  });

  it("names a kind that is not one of the four", () => {
    const problems = check(plan(TWO, "- 1: test:a.test.js\n- 2: magic:x"));
    expect(problems.join("\n")).toMatch(/"- 2: magic:x".*"magic".*test, cmd, ui or human/);
  });

  it("names a line that says nothing of what is checked", () => {
    expect(check(plan(TWO, "- 1: test:a.test.js\n- 2: ui:  ")).join("\n")).toMatch(
      /"- 2: ui:".*nothing after/,
    );
    expect(check(plan(TWO, "- 1: test:a.test.js\n- 2: later")).join("\n")).toMatch(
      /"- 2: later".*<kind>:<what>/,
    );
  });

  it("names a test file that is not in the checkout", () => {
    const problems = check(plan(TWO, "- 1: test:gone.test.js\n- 2: ui:x"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/gone\.test\.js.*not a file in the commit/);
  });

  it("names a missing heading", () => {
    expect(check("# Plan\n\n1. It adds.\n\n## Verification contract\n\n- 1: ui:x\n").join("\n")).toMatch(
      /no "Acceptance criteria" heading/,
    );
    expect(check("# Plan\n\n## Acceptance criteria\n\n1. It adds.\n").join("\n")).toMatch(
      /no "Verification contract" heading/,
    );
    expect(check(plan("Nothing numbered.", "- 1: ui:x")).join("\n")).toMatch(/no numbered item/);
  });

  it("refuses a path that leaves the checkout, and a file that is not there", () => {
    writeFileSync(join(dirname(root), "outside.md"), plan("1. x", "- 1: ui:x"));
    expect(planProblems(root, "../outside.md").join("\n")).toMatch(/outside the checkout/);
    expect(planProblems(root, "/etc/hosts").join("\n")).toMatch(/outside the checkout/);
    expect(planProblems(root, "docs/none.md").join("\n")).toMatch(/not a file in the commit/);
    rmSync(join(dirname(root), "outside.md"));
  });
  // the plan is an agent's file, and the gate runs in the host: a line built to make a pattern
  // retry must not hold it, and a plan is never large
  it("reads a heading with a very long run of spaces without stalling", () => {
    const long = `## a${" ".repeat(60_000)}b`;
    const started = Date.now();
    expect(check(`${long}\n${plan(TWO, "- 1: cmd:true\n- 2: cmd:true")}`)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("refuses a plan of more than a megabyte", () => {
    const problems = check(plan(TWO, "- 1: cmd:true\n- 2: cmd:true") + "x".repeat(1_100_000));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/larger than 1 MB/);
  });
});
