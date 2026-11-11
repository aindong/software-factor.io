// From the factory's fifth real run on itself: a reviewer of the panel passed the change and named
// the impact lane as if it were a gate. The host rejected that hand-off, which counted as the
// member's "fail", and a finished task was sent back and stopped. A hand-off rejected for its form
// goes back to the member once, when the lane has a repair round.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { handoffHelp } from "../../src/core/engine/prompt.ts";
import type { Lane } from "../../src/core/schema/workflow.ts";
import { flowRepo, panelLane, pass, promptsOf, sessionRows, trail } from "../helpers/repo.ts";

const two = [{ id: "logic" }, { id: "needs" }];
// a pass whose claim names a lane where a gate belongs
const wrong = pass({ claims: [{ text: "The impact lane ran the tests.", evidence: ["gate:impact"] }] });
const right = pass({ claims: [{ text: "The change is the one commit.", evidence: ["commit:HEAD"] }] });

it("gives a member one more try at a hand-off the host rejected, with the reason, and takes its verdict then", () => {
  const repo = flowRepo({
    lanes: [panelLane(two, { limits: { repairRounds: 1 } })],
    scripts: { reviewer: { "review.logic": [[wrong], [right]], "review.needs": [pass()] } },
  });
  expect(repo.sf("run").status).toBe(0);
  expect(trail(repo)).toEqual(["review:pass"]);
  // the member that was sent back started twice, the other once
  expect(sessionRows(repo, "lane, try")).toEqual(
    expect.arrayContaining([
      { lane: "review.logic", try: 1 },
      { lane: "review.logic", try: 2 },
      { lane: "review.needs", try: 1 },
    ]),
  );
  expect(sessionRows(repo)).toHaveLength(3);
  const again = promptsOf(repo, "review").find((p) => /hand-off was rejected/.test(p)) ?? "";
  expect(again).toMatch(/gate:impact|the gate "impact"/);
});

it("fails the lane, naming the member, when the second hand-off is rejected too", () => {
  const repo = flowRepo({
    lanes: [panelLane(two, { limits: { repairRounds: 1 } })],
    scripts: { reviewer: { "review.logic": [[wrong], [wrong]], "review.needs": [pass()] } },
  });
  expect(repo.sf("run").status).toBe(1);
  expect(repo.rows<{ note: string }>("select note from lane_runs")[0]?.note).toMatch(
    /logic: fail.*hand-off was rejected/,
  );
  expect(sessionRows(repo)).toHaveLength(3);
});

it("does not start a member again when the lane has no repair round, or when the member said fail", () => {
  const none = flowRepo({
    lanes: [panelLane(two)],
    scripts: { reviewer: { "review.logic": [[wrong], [right]], "review.needs": [pass()] } },
  });
  expect(none.sf("run").status).toBe(1);
  expect(sessionRows(none)).toHaveLength(2);
  const said = flowRepo({
    lanes: [panelLane(two, { limits: { repairRounds: 1 } })],
    scripts: {
      reviewer: {
        "review.logic": [{ handoff: { outcome: "fail", summary: "It is wrong." } }],
        "review.needs": [pass()],
      },
    },
  });
  expect(said.sf("run").status).toBe(1);
  expect(sessionRows(said)).toHaveLength(2);
});

it("the review lane of the shipped alleo-loop has that round, and the prompt says a lane is not a gate", () => {
  const shipped = JSON.parse(readFileSync("workflows/alleo-loop.json", "utf8")) as {
    lanes: { id: string; limits?: { repairRounds?: number } }[];
  };
  expect(shipped.lanes.find((l) => l.id === "review")?.limits?.repairRounds).toBe(1);
  const help = handoffHelp(
    { id: "review" } as unknown as Lane,
    "/lane/handoff.json",
    "/lane/evidence",
    false,
  );
  expect(help).toMatch(
    /"gate:<lane>\.<gate>" for a gate that passed in this run, such as "gate:build\.verify"/,
  );
  expect(help).toMatch(/a lane's own report is not evidence/i);
});
