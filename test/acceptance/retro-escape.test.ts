// An escape opens a retro.
import { expect, it } from "vitest";
import { cleanRun, ladderRepo } from "../helpers/ladder.ts";

it("lists a retro for an escape, and the escape says that one is open", () => {
  const repo = ladderRepo();
  expect(repo.sf("retro").stdout).toMatch(/Nothing calls for a retro/);
  const run = cleanRun(repo);
  const escaped = repo.sf("escape", run, "--lane", "build", "--note", "The export left out refunded orders");
  expect(escaped.status, escaped.stderr).toBe(0);
  expect(escaped.stdout).toContain("softwarefactor retro");
  const r = repo.sf("retro");
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toMatch(
    new RegExp(`^1\\s+open\\s+escape\\s+lane build, run ${run}: The export left out refunded orders$`, "m"),
  );
  expect(r.stdout).toContain("softwarefactor retro draft 1");
  // listed once, however often it is looked at
  expect(repo.sf("retro").stdout.match(/^\d+\s+open/gm)).toHaveLength(1);
});
