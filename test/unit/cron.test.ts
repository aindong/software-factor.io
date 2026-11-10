// The five fields of a schedule: what can be read, and when it was last due.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cronProblem, lastDue } from "../../src/core/collectors/cron.ts";
import { parseWorkflow } from "../../src/core/schema/parse.ts";

const at = (cron: string, now: string) => lastDue(cron, new Date(now))?.toISOString();

describe("a cron line", () => {
  it.each(["0 3 * * *", "*/15 1-5 1,15 * 1-5", "5 0 * 8 7", "0-30/10 * * * *"])("%s can be read", (cron) => {
    expect(cronProblem(cron)).toBeUndefined();
  });
  it.each([
    ["61 * * * *", "minute"],
    ["0 24 * * *", "hour"],
    ["0 0 0 * *", "day"],
    ["0 0 * 13 *", "month"],
    ["0 0 * * 8", "weekday"],
    ["0 0 * * mon", "weekday"],
    ["*/0 * * * *", "minute"],
    ["5-1 * * * *", "minute"],
    ["1,,2 * * * *", "minute"],
    ["* * * *", "five"],
  ])("%s cannot, and the problem names the %s", (cron, word) => {
    expect(cronProblem(cron)).toContain(word);
  });

  it("is a problem of the workflow at the collector's cron, with a fix", () => {
    const w = JSON.parse(readFileSync("workflows/research-only.json", "utf8"));
    const i = w.collectors.findIndex((c: { uses: string }) => c.uses === "core/schedule@1");
    w.collectors[i].with.cron = "61 * * * *";
    const bad = parseWorkflow(w).problems;
    expect(bad.map((p) => p.path)).toEqual([`collectors[${i}].with.cron`]);
    expect(bad[0]?.message).toContain('minute "61"');
    expect(bad[0]?.message).toContain("0 to 59");
    expect(bad[0]?.fix).toMatch(/0 3 \* \* \*/);
    w.collectors[i].with.cron = "*/15 1-5 1,15 * 1-5";
    expect(parseWorkflow(w).problems).toEqual([]);
  });
});

describe("when a schedule was last due", () => {
  // the test runs in whatever zone the machine is in: the times are given and read as local time
  const local = (text: string) => new Date(text).toISOString();
  it("is the latest matching minute at or before now", () => {
    expect(at("0 3 * * *", "2031-05-06T10:00:20")).toBe(local("2031-05-06T03:00:00"));
    expect(at("0 3 * * *", "2031-05-06T02:59:00")).toBe(local("2031-05-05T03:00:00"));
    expect(at("*/15 * * * *", "2031-05-06T10:44:59")).toBe(local("2031-05-06T10:30:00"));
  });
  it("takes the day of the month or the day of the week when both are given, as cron does", () => {
    // 2031-05-06 is a Tuesday: the 1st of the month, or any Monday
    expect(at("0 0 1 * 1", "2031-05-06T10:00:00")).toBe(local("2031-05-05T00:00:00"));
  });
  it("reads every field: a list, a range, a step, a day of the month, a month, a weekday", () => {
    // 2031-05-06 is a Tuesday
    expect(at("0 9 * * 1-5", "2031-05-04T12:00:00")).toBe(local("2031-05-02T09:00:00")); // Sunday: last due on Friday
    expect(at("0,30 * * * *", "2031-05-06T10:44:00")).toBe(local("2031-05-06T10:30:00"));
    expect(at("0 8-10 * * *", "2031-05-06T12:00:00")).toBe(local("2031-05-06T10:00:00"));
    expect(at("0 */6 * * *", "2031-05-06T13:00:00")).toBe(local("2031-05-06T12:00:00"));
    expect(at("0 0 15 * *", "2031-05-06T10:00:00")).toBe(local("2031-04-15T00:00:00"));
    expect(at("0 0 1 5 *", "2031-05-06T10:00:00")).toBe(local("2031-05-01T00:00:00"));
    expect(at("0 0 * * 0", "2031-05-06T10:00:00")).toBe(local("2031-05-04T00:00:00"));
    expect(at("0 0 * * 7", "2031-05-06T10:00:00")).toBe(local("2031-05-04T00:00:00"));
  });
  it("is nothing when it was not due in the last 31 days", () => {
    expect(at("0 0 30 2 *", "2031-05-06T10:00:00")).toBeUndefined();
  });
});
