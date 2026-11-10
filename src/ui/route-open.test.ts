// From the correctness review of task 17: what the address says is open, for addresses a person
// can type or paste.
import { expect, it } from "vitest";
import { openIn } from "./route.ts";

it("names what is open under a section", () => {
  expect(openIn("/runs/abc123", "/runs")).toBe("abc123");
  expect(openIn("/runs", "/runs")).toBeUndefined();
  expect(openIn("/runs/", "/runs")).toBeUndefined();
  expect(openIn("/inbox/abc", "/runs")).toBeUndefined();
  expect(openIn("/runsabc", "/runs")).toBeUndefined();
});
it("a broken percent sign does not throw", () => {
  expect(() => openIn("/runs/%", "/runs")).not.toThrow();
  expect(openIn("/runs/%", "/runs")).toBe("%");
  expect(openIn("/inbox/%E0", "/inbox")).toBe("%E0");
});
it("a trailing slash still names the run", () => {
  expect(openIn("/runs/abc/", "/runs")).toBe("abc");
  expect(openIn("/runs/a%20b/", "/runs")).toBe("a b");
});
