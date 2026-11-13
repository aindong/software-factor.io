import { describe, expect, it } from "vitest";
import { leadLane } from "./lead.ts";

const lanes = [
  { id: 1, lane: "sort" },
  { id: 2, lane: "build" },
  { id: 3, lane: "build" },
];
const after = { kind: "approval", lane: "build", decisions: ["approve", "reject", "send-back"] };
const before = { kind: "approval", lane: "ship", decisions: ["approve", "reject"] };
const question = { kind: "question", lane: "build", decisions: ["answer"] };

describe("the lane an inbox item is about, shown first", () => {
  it("is the lane that has just finished and waits for approval, in its latest round", () => {
    expect(leadLane(lanes, after)?.id).toBe(3);
  });
  it("is the last lane that ran, for an approval asked before a lane runs", () => {
    expect(leadLane(lanes, before)?.id).toBe(3);
    expect(leadLane(lanes.slice(0, 1), before)?.id).toBe(1);
  });
  it("is the lane that asked, for a question", () => {
    expect(leadLane(lanes, { ...question, lane: "sort" })?.id).toBe(1);
  });
  it("is none when no lane has run", () => {
    expect(leadLane([], before)).toBeUndefined();
    expect(leadLane([], after)).toBeUndefined();
  });
});
