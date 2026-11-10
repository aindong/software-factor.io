// A retro's draft: what the record knows, and the parts a person fills.
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { cleanRun, ladderRepo } from "../helpers/ladder.ts";

it("drafts a retro from the record, lists it as drafted, and does not write over it", () => {
  const repo = ladderRepo();
  const run = cleanRun(repo);
  repo.sf("escape", run, "--lane", "build", "--note", "The export left out refunded orders");
  const r = repo.sf("retro", "draft", "1");
  expect(r.status, r.stderr).toBe(0);
  const [name] = readdirSync(join(repo.dir, ".factor/retros"));
  expect(name).toMatch(/^\d{4}-\d{2}-\d{2}-escape-build-1\.md$/);
  expect(r.stdout).toContain(`.factor/retros/${name}`);
  const draft = repo.read(`.factor/retros/${name}`);
  for (const held of [
    run,
    "build",
    "The export left out refunded orders",
    "verify",
    "pass",
    `.factor/runs/${run}/evidence/`,
    "## Why it got through",
    "## The lesson, in one line",
    "## The check that would catch it",
    '"uses": "core/command@1"',
    "softwarefactor retro keep 1 --lesson",
  ])
    expect(draft, held).toContain(held);
  // what the run's own people and agents wrote is quoted, never a heading of the draft
  expect(draft).toMatch(/^> The export left out refunded orders$/m);
  expect(repo.sf("retro").stdout).toMatch(
    new RegExp(`^1\\s+drafted\\s+escape.*\\.factor/retros/${name.replace(".", "\\.")}`, "m"),
  );

  writeFileSync(join(repo.dir, ".factor/retros", name ?? ""), "mine\n");
  const again = repo.sf("retro", "draft", "1");
  expect(again.status).toBe(0);
  expect(again.stdout).toMatch(/already drafted/);
  expect(repo.read(`.factor/retros/${name}`)).toBe("mine\n");
  expect(repo.sf("retro", "draft", "9").status).toBe(1);
});
