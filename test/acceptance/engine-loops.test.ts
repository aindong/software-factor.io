import { describe, expect, it } from "vitest";
import { agentLane, commitFile, fail, flowRepo, pass, promptsOf, runRow, trail } from "../helpers/repo.ts";

const loop = (scripts: Record<string, Record<string, unknown>>) =>
  flowRepo({
    lanes: [
      agentLane("build", {
        agent: { access: "write" },
        gates: ["verify"],
        on: { pass: "review", fail: "@stop" },
      }),
      agentLane("review", {
        agent: { role: "reviewer" },
        on: { pass: "@done", fail: [{ to: "build", maxRounds: 2 }, { to: "@stop" }] },
      }),
    ],
    scripts,
  });
const builds = [
  [...commitFile("a.txt"), pass()],
  [...commitFile("b.txt"), pass()],
  [...commitFile("c.txt"), pass()],
];

describe("a review loop", () => {
  it("stops at its round limit", () => {
    const repo = loop({ author: { build: builds }, reviewer: { review: [fail("needs tests")] } });
    expect(repo.sf("run").status).toBe(1);
    expect(trail(repo)).toEqual([
      "build:pass",
      "review:fail",
      "build:pass",
      "review:fail",
      "build:pass",
      "review:fail",
    ]);
    expect(runRow(repo)).toMatchObject({ status: "stopped", stop_code: "out_of_rounds" });
  });

  it("finishes when the second round passes, and tells the builder why it is back", () => {
    const repo = loop({ author: { build: builds }, reviewer: { review: [[fail("needs tests")], [pass()]] } });
    expect(repo.sf("run").status).toBe(0);
    expect(trail(repo)).toEqual(["build:pass", "review:fail", "build:pass", "review:pass"]);
    expect(runRow(repo)).toMatchObject({ status: "done", stop_code: "done" });
    const prompts = promptsOf(repo, "build");
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain("needs tests");
    expect(prompts[1]).toContain("needs tests");
  });

  it("stops early when the builder comes back with no new commit", () => {
    const repo = loop({
      author: { build: [[...commitFile("a.txt"), pass()], [pass()]] },
      reviewer: { review: [fail("needs tests")] },
    });
    expect(repo.sf("run").status).toBe(1);
    expect(trail(repo)).toEqual(["build:pass", "review:fail", "build:pass", "review:fail"]);
    expect(runRow(repo)).toMatchObject({ status: "stopped", stop_code: "no_progress" });
  });

  it("counts rounds for each loop on its own", () => {
    const back = [{ to: "build", maxRounds: 1 }, { to: "@stop" }];
    const repo = flowRepo({
      lanes: [
        agentLane("build", {
          agent: { access: "write" },
          gates: ["verify"],
          on: { pass: "review", fail: "@stop" },
        }),
        agentLane("review", { agent: { role: "reviewer" }, on: { pass: "audit", fail: back } }),
        agentLane("audit", { agent: { role: "reviewer" }, on: { pass: "@done", fail: back } }),
      ],
      scripts: {
        author: { build: builds },
        reviewer: { review: [[fail("x")], [pass()]], audit: [[fail("y")], [pass()]] },
      },
    });
    expect(repo.sf("run").status).toBe(0);
    expect(trail(repo)).toEqual([
      "build:pass",
      "review:fail",
      "build:pass",
      "review:pass",
      "audit:fail",
      "build:pass",
      "review:pass",
      "audit:pass",
    ]);
  });

  it("drops a task when a lane says it is not work", () => {
    const repo = flowRepo({
      lanes: [agentLane("confirm", { on: { pass: "@done", fail: "@drop" } })],
      scripts: { author: { confirm: [fail("a duplicate")] } },
    });
    expect(repo.sf("run").status).toBe(0);
    expect(runRow(repo)).toMatchObject({ status: "dropped", stop_code: "dropped" });
    expect(repo.rows("select status from tasks")).toEqual([{ status: "dropped" }]);
  });
});
