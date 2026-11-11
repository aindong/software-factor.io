// `--list` only lists: with a flag that needs the cases to run it is a mistake, said before anything is done.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { makeRepo } from "../helpers/repo.ts";

it("refuses --list with --break, --save or --compare, in words, exit 1, and does nothing", () => {
  const repo = makeRepo();
  const save = join(repo.home, "evals/out.json");
  const missing = join(repo.home, "nothing.json");
  const tries: [string[], string][] = [
    [["eval", "--list", "--break", "core/no-secrets@1"], "--break"],
    [["eval", "--break", "core/no-secrets@1", "--list"], "--break"],
    [["eval", "--list", "--save", save], "--save"],
    [["eval", "--save", save, "--list"], "--save"],
    [["eval", "--list", "--compare", missing], "--compare"],
    [["eval", "--compare", missing, "--list"], "--compare"],
    [["eval", "--list", "--break", "no-such-gate"], "--break"],
    [["eval", "--list", "--break", "core/no-secrets@1", "--save", save, "--compare", missing], "--break"],
  ];
  for (const [args, flag] of tries) {
    const r = repo.sf(...args);
    const said = args.join(" ");
    expect(r.status, said).toBe(1);
    expect(r.stdout, said).toBe("");
    expect(r.stderr, said).toContain("--list");
    expect(r.stderr, said).toContain(flag);
    expect(r.stderr, said).toMatch(/fix:/);
    expect(r.stderr, said).not.toMatch(/There is no (file|gate)/);
  }
  expect(existsSync(join(repo.home, "evals")), "--save made a folder").toBe(false);
});
