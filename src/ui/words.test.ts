import { describe, expect, it } from "vitest";
import { finished, howLong, lede } from "./words.ts";

describe("finished", () => {
  it("drops the sentence the store cut in half", () => {
    expect(finished("It works. The next part is cut becau...")).toBe("It works.");
  });
  it("keeps a note that was not cut", () => {
    expect(finished("Done, with docs/a.md changed.")).toBe("Done, with docs/a.md changed.");
  });
  it("keeps one long sentence, with an ellipsis", () => {
    expect(finished("A sentence that never ends and is cut...")).toBe(
      "A sentence that never ends and is cut…",
    );
  });
  it("does not end at a file name", () => {
    expect(finished("See docs/plan.md for more. And then docs/x.md has...")).toBe(
      "See docs/plan.md for more.",
    );
  });
});

describe("howLong", () => {
  it("says it in minutes and hours", () => {
    expect([howLong(20_000), howLong(13 * 60_000 + 21_000), howLong(3_600_000), howLong(7_500_000)]).toEqual([
      "under a minute",
      "13 min",
      "1 h",
      "2 h 5 min",
    ]);
  });
});

describe("lede", () => {
  const run = (status: string, stopCode?: string) => ({ status, stopCode }) as never;
  it("says whether a person is needed", () => {
    expect(lede(run("running"), "Build")).toEqual({
      says: "At work in Build.",
      needs: false,
      line: "Nothing is needed from you.",
    });
    expect(lede(run("waiting", "awaiting_approval"), "Review")).toMatchObject({
      needs: true,
      line: "This needs you.",
    });
    expect(lede(run("stopped"), "Build").says).toBe("Stopped before it finished.");
  });
});
