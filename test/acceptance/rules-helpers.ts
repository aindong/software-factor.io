import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseWorkflow } from "../../src/core/schema/parse.ts";

// biome-ignore lint/suspicious/noExplicitAny: the tests break a valid workflow on purpose
export type Loose = any;
export type Change = (w: Loose) => void;
/** A broken rule: its name, the change that breaks it, where the problem must point, what the fix must say. */
export type Reject = [string, Change, RegExp, RegExp];

/** The rules have their own small valid workflow, so editing a shipped example cannot break them. */
export const base = (): Loose => JSON.parse(readFileSync("test/fixtures/workflows/rules-base.json", "utf8"));
export const lane = (w: Loose, id: string) => w.lanes.find((l: Loose) => l.id === id);
export const bounded = [{ to: "fix", maxRounds: 2 }, { to: "@stop" }];
export const guarded = [{ to: "open-pr", when: { ref: "change.tier", in: ["ui"] } }, { to: "@stop" }];

export function describeRejects(title: string, cases: Reject[]) {
  describe(title, () => {
    it.each(cases)("rejects %s", (_name, breakIt, where, fix) => {
      const w = base();
      breakIt(w);
      const { problems, workflow } = parseWorkflow(w);
      expect(workflow).toBeUndefined();
      const hit = problems.find((p) => where.test(p.path) && fix.test(p.fix));
      expect(hit, `problems were: ${JSON.stringify(problems, null, 1)}`).toBeDefined();
    });
  });
}

export function describeAccepts(title: string, cases: [string, Change][]) {
  describe(title, () => {
    it.each(cases)("accepts %s", (_name, change) => {
      const w = base();
      change(w);
      expect(parseWorkflow(w).problems).toEqual([]);
    });
  });
}
