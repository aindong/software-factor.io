import { describe, expect, it } from "vitest";
import { figures } from "./costs-figures.ts";

const none = { tasks: 0, ended: 0, perTask: null };
describe("the cache hit rate and the cost per landed task", () => {
  it("says none yet when there is nothing to show", () => {
    expect(figures({ cacheRate: null, landed: none })).toEqual({
      cache: "none yet",
      cacheNote: "No session could read from a cache.",
      perTask: "none landed yet",
      perTaskNote: "There is no landed task to divide the cost by.",
    });
  });
  it("never reads as a bare zero: a landed task that cost nothing says what it is out of", () => {
    expect(figures({ cacheRate: null, landed: { tasks: 1, ended: 2, perTask: 0 } })).toMatchObject({
      perTask: "$0.00 for 1 landed of 2",
    });
    expect(figures({ cacheRate: null, landed: { tasks: 3, ended: 3, perTask: 0 } }).perTask).toBe(
      "$0.00 for 3 landed of 3",
    );
  });
  it("says none landed yet when tasks ended but none landed, with a cost of nothing", () => {
    expect(figures({ cacheRate: null, landed: { tasks: 0, ended: 2, perTask: 0 } }).perTask).toBe(
      "none landed yet",
    );
  });
  it("shows the rate and the cost of a landed task as the command prints them", () => {
    expect(figures({ cacheRate: 91, landed: { tasks: 1, ended: 2, perTask: 0.61 } })).toEqual({
      cache: "91%",
      cacheNote: "of what went in was read from a cache",
      perTask: "$0.61",
      perTaskNote: "1 of 2 ended tasks landed, every run of them counted",
    });
  });
  it("says not known when a landed task's cost is not", () => {
    expect(figures({ cacheRate: 0, landed: { tasks: 1, ended: 1, perTask: null } })).toMatchObject({
      cache: "0%",
      perTask: "not known",
      perTaskNote: "1 of 1 ended task landed, every run of them counted",
    });
  });
});
