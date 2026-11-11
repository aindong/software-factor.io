// From the factory's first real run on itself: a lane was failed twice for an output that was not
// one of its allowed values, and its prompt had never said what the values were.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { handoffHelp } from "../../src/core/engine/prompt.ts";
import type { Lane } from "../../src/core/schema/workflow.ts";
import { agentLane, flowRepo, pass, promptsOf, trail } from "../helpers/repo.ts";

const outputs = {
  fact: { type: "string", required: true, description: "The fact the change's safety rests on." },
  proof: { type: "string", enum: ["claimed", "cited", "argued", "run", "reproduced"], required: true },
  findings: { type: "array", description: "Every finding, with its proof." },
};

it("tells the agent each output's allowed values, what it is for, and which ones it must give", () => {
  // the part of the prompt an agent with an account gets on top of its lane's own words
  const prompt = handoffHelp(
    { id: "impact", outputs } as unknown as Lane,
    "/lane/handoff.json",
    "/lane/evidence",
    false,
  );
  expect(prompt).toMatch(
    /"proof": text, exactly one of "claimed", "cited", "argued", "run", "reproduced"\. Required\./,
  );
  expect(prompt).toMatch(/"fact": text\. Required\. The fact the change's safety rests on\./);
  expect(prompt).toMatch(/"findings": a list\. Every finding, with its proof\./);
  expect(prompt).not.toMatch(/"findings": a list\. Required/);
  expect(
    handoffHelp({ id: "build" } as unknown as Lane, "/lane/handoff.json", "/lane/evidence", false),
  ).toMatch(/Leave "outputs" out/);
});

it("gives the impact lane of the shipped full-loop a second try at a hand-off the host rejected", () => {
  const shipped = JSON.parse(readFileSync("workflows/full-loop.json", "utf8")) as {
    lanes: { id: string; limits?: { repairRounds?: number } }[];
  };
  expect(shipped.lanes.find((l) => l.id === "impact")?.limits?.repairRounds).toBe(1);
});

it("takes a second hand-off with an allowed value when the lane has a repair round", () => {
  const repo = flowRepo({
    lanes: [agentLane("impact", { outputs, limits: { repairRounds: 1 } })],
    scripts: {
      author: {
        impact: [
          [pass({ outputs: { fact: "Nothing reads it.", proof: "I ran the tests and they passed." } })],
          [pass({ outputs: { fact: "Nothing reads it.", proof: "run" } })],
        ],
      },
    },
  });
  expect(repo.sf("run").status).toBe(0);
  expect(trail(repo)).toEqual(["impact:pass"]);
  expect(promptsOf(repo, "impact")[1]).toMatch(
    /hand-off was rejected[\s\S]*proof[\s\S]*claimed, cited, argued, run, reproduced/,
  );
});
