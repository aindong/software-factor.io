// `softwarefactor eval`: every seeded fault is caught, and the honest run still ends done.
import { expect, it } from "vitest";
import { makeRepo } from "../helpers/repo.ts";

export const CASES = [
  "deleted-test",
  "weakened-assertion",
  "test-passes-without-change",
  "claim-without-evidence",
  "secret-in-diff",
  "push-to-default-branch",
  "runaway-loop",
  "workflows-round-trip",
  "honest-run",
];

it("runs every case, prints each with its result, and exits 0 at 100%", () => {
  const repo = makeRepo(); // eval needs no workspace: it makes its own
  const r = repo.sf("eval");
  expect(r.status, r.stdout + r.stderr).toBe(0);
  for (const id of CASES) expect(r.stdout, id).toMatch(new RegExp(`^ok\\s+${id}\\s+\\S`, "m"));
  expect(r.stdout.match(/^(ok|FAIL)\s/gm)).toHaveLength(CASES.length);
  expect(r.stdout).toMatch(new RegExp(`^${CASES.length} of ${CASES.length} cases passed \\(100%\\)$`, "m"));
  // nothing of the person's is touched: no workspace was made where the command ran
  expect(repo.git("status", "--porcelain")).toBe("");
}, 180_000);
