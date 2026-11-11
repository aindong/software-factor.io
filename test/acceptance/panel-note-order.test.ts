// From the critique of the run's page: a stopped review said "correctness: pass. ..." first, and
// the member that failed it was cut off the end of the sentence. The members that made the
// verdict are named first.
import { expect, it } from "vitest";
import { fail, flowRepo, panelLane, pass } from "../helpers/repo.ts";

const long = `Read every file of the change against the plan and ran what could be run. ${"Nothing was found. ".repeat(12)}`;

it("names the member that failed the lane before the ones that passed it, in the lane's note and the run's sentence", () => {
  const repo = flowRepo({
    lanes: [panelLane([{ id: "logic" }, { id: "needs" }, { id: "style", advisory: true }])],
    scripts: {
      reviewer: {
        "review.logic": [pass({ summary: long })],
        "review.needs": [fail("criterion 2 is not met")],
        "review.style": [pass({ summary: "Reads well." })],
      },
    },
  });
  expect(repo.sf("run").status).toBe(1);
  const note = repo.rows<{ note: string }>("select note from lane_runs")[0]?.note ?? "";
  expect(note).toMatch(
    /^needs: fail\. criterion 2 is not met; logic: pass\. Read every file.*; style \(advises\): pass\. Reads well\.$/,
  );
  // the one line a person reads in the list of runs holds the reason, not a passing member's words
  const sentence = repo.sf("runs").stdout.split("\n")[1] ?? "";
  expect(sentence).toMatch(/needs: fail\. criterion 2 is not met/);
});

it("keeps the members' own order when they all pass", () => {
  const repo = flowRepo({
    lanes: [panelLane([{ id: "logic" }, { id: "needs" }])],
    scripts: { reviewer: { "*": [pass({ summary: "Fine." })] } },
  });
  expect(repo.sf("run").status).toBe(0);
  expect(repo.rows<{ note: string }>("select note from lane_runs")[0]?.note).toBe(
    "logic: pass. Fine.; needs: pass. Fine.",
  );
});
