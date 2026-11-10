// A result can be saved, and a later run compared with it: what passed then and is not caught now is a regression.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { makeRepo } from "../helpers/repo.ts";
import { CASES } from "./eval-passes.test.ts";

it("saves a result, and names the regressions against it", () => {
  const repo = makeRepo();
  const file = join(repo.home, "eval.json");
  const saved = repo.sf("eval", "--save", file);
  expect(saved.status, saved.stdout + saved.stderr).toBe(0);
  expect(existsSync(file)).toBe(true);
  const result = JSON.parse(readFileSync(file, "utf8")) as { cases: { id: string; passed: boolean }[] };
  expect(result.cases.map((c) => c.id)).toEqual(CASES);
  expect(result.cases.every((c) => c.passed)).toBe(true);

  const same = repo.sf("eval", "--compare", file);
  expect(same.status, same.stdout).toBe(0);
  expect(same.stdout).toMatch(/Nothing is worse than in /);

  const worse = repo.sf("eval", "--compare", file, "--break", "core/no-secrets@1");
  expect(worse.status).toBe(1);
  expect(worse.stdout).toMatch(/^Regression: secret-in-diff passed in .* and is not caught now$/m);
  expect(worse.stdout.match(/^Regression: /gm)).toHaveLength(1);

  const missing = repo.sf("eval", "--compare", join(repo.home, "nothing.json"));
  expect(missing.status).toBe(1);
}, 300_000);
