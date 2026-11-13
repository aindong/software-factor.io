import { describe, expect, it } from "vitest";
import { statusOf } from "../../src/ui/status.ts";

const clean = { broken: undefined, problems: 0, dirty: false, notice: undefined };

describe("the floor's status line", () => {
  it("says when the workflow was saved, once it was saved here", () => {
    expect(statusOf({ ...clean, savedAt: "2026-11-13T10:00:00Z" })).toEqual({
      text: "Saved",
      bad: false,
      since: "2026-11-13T10:00:00Z",
    });
  });
  it("says only Saved for a workflow read as it is, and not saved at all while it has changes", () => {
    expect(statusOf(clean).since).toBeUndefined();
    expect(statusOf({ ...clean, dirty: true, savedAt: "2026-11-13T10:00:00Z" })).toEqual({
      text: "Not saved",
      bad: false,
    });
  });
});
