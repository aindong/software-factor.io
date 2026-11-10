// A retro that is not worth a lesson is dropped, with the reason, and stays dropped.
import { expect, it } from "vitest";
import { cleanRun, ladderRepo } from "../helpers/ladder.ts";

it("drops a retro with a reason and does not open it again", () => {
  const repo = ladderRepo();
  const run = cleanRun(repo);
  repo.sf("escape", run, "--lane", "build", "--note", "A typo");
  expect(repo.sf("retro", "drop", "1").status).toBe(1);
  const r = repo.sf("retro", "drop", "1", "--note", "A one-off: the fixture was wrong");
  expect(r.status, r.stderr).toBe(0);
  const out = repo.sf("retro").stdout;
  expect(out).toMatch(/^1\s+dropped\s+escape.*A one-off: the fixture was wrong/m);
  expect(out.match(/^\d+\s+open/gm)).toBeNull();
  expect(repo.sf("retro", "keep", "1", "--lesson", "Too late.").status).toBe(1);
});
