import { describe, expect, it } from "vitest";
import { agentLane, commitFile, flowRepo, promptsOf, trail } from "../helpers/repo.ts";

const ok = { outcome: "pass", summary: "Did the work." };
const flow = (handoffs: Record<string, unknown>[], lane: Record<string, unknown> = {}) =>
  flowRepo({
    lanes: [agentLane("build", { agent: { access: "write" }, gates: ["verify"], ...lane })],
    scripts: {
      author: { build: handoffs.map((h) => [...commitFile(`f${handoffs.indexOf(h)}.txt`), { handoff: h }]) },
    },
  });
const noteOf = (repo: ReturnType<typeof flow>) =>
  repo.rows<{ note: string }>("select note from lane_runs")[0]?.note ?? "";

describe("a hand-off the host rejects", () => {
  it.each([
    [
      "a claim with no evidence",
      { ...ok, claims: [{ text: "It works.", evidence: [] }] },
      /claims\[0\].*evidence/,
    ],
    [
      "a claim whose evidence key is missing",
      { ...ok, claims: [{ text: "It works." }] },
      /claims\[0\].*evidence/,
    ],
    [
      "a file that was never committed",
      { ...ok, claims: [{ text: "It works.", evidence: ["file:not-there.txt"] }] },
      /not-there\.txt/,
    ],
    [
      "an attachment that was never attached",
      { ...ok, claims: [{ text: "Seen.", evidence: ["attached:shot.png"] }] },
      /shot\.png/,
    ],
    [
      "a gate that did not pass in this run",
      { ...ok, claims: [{ text: "Tested.", evidence: ["gate:build.verify"] }] },
      /build\.verify/,
    ],
    [
      "a commit that is not on the run's branch",
      { ...ok, claims: [{ text: "Done.", evidence: ["commit:0000000000000000000000000000000000000000"] }] },
      /commit/,
    ],
    [
      "evidence of a kind the host does not know",
      { ...ok, claims: [{ text: "Done.", evidence: ["trust me"] }] },
      /trust me/,
    ],
    ["a key the format does not have", { ...ok, claim: [] }, /claim/],
    ["no summary", { outcome: "pass" }, /summary/],
    ["an outcome that is not one of the three", { outcome: "done", summary: "x" }, /outcome/],
  ])("%s", (_name, handoff, says) => {
    const repo = flow([handoff as Record<string, unknown>]);
    expect(repo.sf("run").status).toBe(1);
    expect(trail(repo)).toEqual(["build:fail"]);
    expect(noteOf(repo)).toMatch(/hand-off/);
    expect(noteOf(repo)).toMatch(says);
    expect(repo.rows("select id from claims")).toEqual([]);
  });

  const outputs = {
    size: { type: "string", enum: ["easy", "hard"], required: true },
    count: { type: "number" },
  };
  it.each([
    ["a required output that is missing", { ...ok }, /size/],
    ["an output outside its allowed values", { ...ok, outputs: { size: "huge" } }, /size.*easy, hard/],
    ["an output of the wrong type", { ...ok, outputs: { size: "easy", count: "three" } }, /count.*number/],
    ["an output the lane does not declare", { ...ok, outputs: { size: "easy", extra: 1 } }, /extra/],
  ])("%s", (_name, handoff, says) => {
    const repo = flow([handoff as Record<string, unknown>], { outputs });
    expect(repo.sf("run").status).toBe(1);
    expect(noteOf(repo)).toMatch(says);
  });

  it("goes back to the agent with the reason when the lane has repair rounds left", () => {
    const repo = flow(
      [
        { ...ok, claims: [{ text: "It works.", evidence: [] }] },
        { ...ok, claims: [{ text: "It works.", evidence: ["commit:HEAD"] }] },
      ],
      {
        limits: { repairRounds: 1 },
      },
    );
    expect(repo.sf("run").status).toBe(0);
    expect(trail(repo)).toEqual(["build:pass"]);
    expect(promptsOf(repo, "build")[1]).toMatch(/hand-off was rejected/);
    expect(promptsOf(repo, "build")[1]).toMatch(/evidence/);
    expect(repo.rows("select text from claims")).toEqual([{ text: "It works." }]);
  });
});
