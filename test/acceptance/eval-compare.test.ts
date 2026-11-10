// A result can be saved, and a later run compared with it: what passed then and is not caught now is a regression.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CASES } from "../helpers/eval.ts";
import { makeRepo } from "../helpers/repo.ts";

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

it("counts a case that is no longer run as worse, reads a broken file as a mistake, and saves into a new folder", () => {
  const repo = makeRepo();
  const file = join(repo.home, "evals/first.json");
  // the folder is not there yet
  expect(repo.sf("eval", "--save", file).status).toBe(0);
  const result = JSON.parse(readFileSync(file, "utf8")) as { cases: { id: string; passed: boolean }[] };
  writeFileSync(
    file,
    JSON.stringify({ ...result, cases: [...result.cases, { id: "a-case-that-was-dropped", passed: true }] }),
  );
  const dropped = repo.sf("eval", "--compare", file);
  expect(dropped.status).toBe(1);
  expect(dropped.stdout).toMatch(/^Regression: a-case-that-was-dropped passed in .* and is not run now$/m);
  expect(dropped.stdout).not.toMatch(/Nothing is worse/);

  writeFileSync(file, "{ not json");
  const broken = repo.sf("eval", "--compare", file);
  expect(broken.status).toBe(1);
  expect(broken.stderr).toMatch(/is not a saved eval result/);
  expect(broken.stderr).not.toMatch(/SyntaxError|\.ts:\d/);
}, 300_000);
