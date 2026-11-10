import { describe, expect, it } from "vitest";
import { tierOf } from "../../src/core/engine/tier.ts";
import { choose, type Facts } from "../../src/core/engine/transition.ts";
import type { Lane } from "../../src/core/schema/workflow.ts";

const facts = (over: Partial<Facts> = {}): Facts => ({
  source: "tasks",
  labels: [],
  tier: "refactor",
  outputs: {},
  gates: {},
  ...over,
});
const lane = (on: unknown): Lane => ({ id: "review", uses: "core/agent@1", checkpoint: "out", on }) as Lane;

describe("choosing the next lane", () => {
  it("takes a plain target, and the inbox when needsPerson is not written", () => {
    const l = lane({ pass: "ship", fail: "@stop" });
    expect(choose(l, "pass", facts(), {}).to).toBe("ship");
    expect(choose(l, "needsPerson", facts(), {}).to).toBe("@inbox");
  });

  it("takes the first entry whose condition holds", () => {
    const l = lane({
      pass: [{ to: "look", when: { ref: "change.tier", in: ["ui"] } }, { to: "ship" }],
      fail: "@stop",
    });
    expect(choose(l, "pass", facts({ tier: "ui" }), {}).to).toBe("look");
    expect(choose(l, "pass", facts(), {}).to).toBe("ship");
  });

  it("counts rounds per entry and moves on when they run out", () => {
    const l = lane({ pass: "@done", fail: [{ to: "build", maxRounds: 2 }, { to: "@stop" }] });
    const first = choose(l, "fail", facts(), {});
    expect(first).toMatchObject({ to: "build", key: "review.fail[0]" });
    expect(choose(l, "fail", facts(), { "review.fail[0]": 1 }).to).toBe("build");
    const spent = choose(l, "fail", facts(), { "review.fail[0]": 2 });
    expect(spent).toMatchObject({ to: "@stop", exhausted: ["review.fail[0]"] });
  });

  it("treats a list value as matching when any item is in the list", () => {
    const l = lane({
      pass: [{ to: "sec", when: { ref: "task.labels", in: ["auth"] } }, { to: "@done" }],
      fail: "@stop",
    });
    expect(choose(l, "pass", facts({ labels: ["ui", "auth"] }), {}).to).toBe("sec");
    expect(choose(l, "pass", facts({ labels: ["ui"] }), {}).to).toBe("@done");
  });

  it("treats a missing value as not in any list", () => {
    const l = lane({
      pass: [
        { to: "a", when: { ref: "plan.outputs.size", in: ["easy"] } },
        { to: "b", when: { ref: "plan.outputs.size", notIn: ["easy"] } },
        { to: "c" },
      ],
      fail: "@stop",
    });
    expect(choose(l, "pass", facts(), {}).to).toBe("b");
  });
});

describe("how risky a change is", () => {
  it.each([
    [["docs/a.md", "README.md"], "docs"],
    [["src/util/math.ts"], "refactor"],
    [["src/api/routes/users.ts"], "api"],
    [["src/components/Button.tsx", "src/util/math.ts"], "ui"],
    [["src/auth/session.ts", "src/components/Button.tsx"], "sensitive"],
    [["db/migrations/002.sql"], "api"],
    [[], "docs"],
  ])("%j is %s", (files, tier) => {
    expect(tierOf(files as string[])).toBe(tier);
  });
});
