// The eval must be able to fail: with one gate broken on purpose, the cases that gate is for are not caught.
import { expect, it } from "vitest";
import { makeRepo } from "../helpers/repo.ts";
import { CASES } from "./eval-passes.test.ts";

it("fails when the gate that keeps tests from being weakened is broken, and names what got through", () => {
  const repo = makeRepo();
  const r = repo.sf("eval", "--break", "core/tests-not-weakened@1");
  expect(r.status, r.stdout + r.stderr).toBe(1);
  expect(r.stdout).toMatch(/^FAIL\s+deleted-test\s+.*not caught/m);
  expect(r.stdout).toMatch(/^FAIL\s+weakened-assertion\s+.*not caught/m);
  for (const id of CASES.filter((c) => c !== "deleted-test" && c !== "weakened-assertion")) {
    expect(r.stdout, id).toMatch(new RegExp(`^ok\\s+${id}\\s`, "m"));
  }
  expect(r.stdout).toMatch(
    new RegExp(`^${CASES.length - 2} of ${CASES.length} cases passed \\(77%\\)$`, "m"),
  );
  expect(r.stdout).toContain("core/tests-not-weakened@1 was broken on purpose");
}, 180_000);

it("refuses to break something that is no gate", () => {
  const repo = makeRepo();
  const r = repo.sf("eval", "--break", "core/nothing@1");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/core\/nothing@1/);
});
