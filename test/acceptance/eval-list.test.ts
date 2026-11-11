// `softwarefactor eval --list`: the cases and what each shows, in the order they run, and no case is run.
import { expect, it } from "vitest";
import { CASES as SHIPPED } from "../../src/core/eval/cases.ts";
import { CASES } from "../helpers/eval.ts";
import { makeRepo } from "../helpers/repo.ts";

it("prints each case's id and its one line, in the order they run, and exits 0", () => {
  const repo = makeRepo();
  const r = repo.sf("eval", "--list");
  expect(r.status, r.stdout + r.stderr).toBe(0);
  expect(r.stderr).toBe("");
  const lines = r.stdout.trimEnd().split("\n");
  expect(lines.map((l) => l.split(/\s+/)[0])).toEqual(CASES);
  expect(SHIPPED.map((c) => c.id)).toEqual(CASES);
  lines.forEach((line, i) => {
    const what = SHIPPED[i]?.what ?? "";
    expect(what.length, CASES[i]).toBeGreaterThan(0);
    expect(line, CASES[i]).toMatch(
      new RegExp(`^${CASES[i]}\\s+${what.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    );
  });
  expect(r.stdout).not.toMatch(/^(ok|FAIL)\s|cases passed/m);
});

it("runs no case: it returns at once and leaves the directory as it was", () => {
  const repo = makeRepo();
  const began = Date.now();
  expect(repo.sf("eval", "--list").status).toBe(0);
  expect(Date.now() - began).toBeLessThan(5_000); // a run is several seconds for each of twelve cases
  expect(repo.git("status", "--porcelain")).toBe("");
});
