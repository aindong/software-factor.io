// What a run's row says when its task is queued again, and where a done run's line is cut.
import { describe, expect, it } from "vitest";
import { sentenceOf } from "../../src/core/runs/sentence.ts";

describe("a run whose task is queued again", () => {
  it("says so, and what starts it, after why it ended", () => {
    expect(
      sentenceOf({ status: "stopped", stopCode: "lane_failed", reason: "a test is red", queued: true }),
    ).toBe("Stopped: a test is red. Its task is queued again: `softwarefactor run` starts it.");
    expect(sentenceOf({ status: "dropped", reason: "a duplicate", queued: true })).toBe(
      "Dropped: a duplicate. Its task is queued again: `softwarefactor run` starts it.",
    );
  });
  it("keeps that part whole when the reason is long", () => {
    const said = sentenceOf({ status: "stopped", reason: "word ".repeat(80), queued: true });
    expect(said.length).toBeLessThanOrEqual(160);
    expect(said).toMatch(/Its task is queued again: `softwarefactor run` starts it\.$/);
  });
  it("says nothing of it for a run that is not over", () => {
    expect(sentenceOf({ status: "done", queued: true })).toBe("Done.");
  });
});

describe("what a done run's last lane said", () => {
  it("is cut at the end of a sentence, not in the middle of one", () => {
    const first = "The release is merged and the branch is deleted.";
    const said = sentenceOf({
      status: "done",
      last: { lane: "Ship it", said: `${first} ${"Then more words follow. ".repeat(12)}` },
    });
    expect(said.length).toBeLessThanOrEqual(160);
    expect(said).not.toMatch(/\.\.\.$/);
    expect(said).toMatch(/[.!?]$/);
    expect(said.startsWith(`Done. Ship it: ${first}`)).toBe(true);
  });
});
