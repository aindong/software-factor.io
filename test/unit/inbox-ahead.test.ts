// What an approval before a command lane shows under the bar: the command's description from the
// workflow and the run's branch. Never for work that was done (it can be sent back), never raw shell.
import { describe, expect, it } from "vitest";
import { aheadOf } from "../../src/core/inbox-ahead.ts";
import type { Workflow } from "../../src/core/schema/workflow.ts";

const flow = (ship: Record<string, unknown>) =>
  ({
    commands: { ship: { description: "Pushes the branch and opens a pull request." } },
    lanes: [
      { id: "build", name: "Build", uses: "core/agent@1" },
      { id: "ship", name: "Ship it", uses: "core/command@1", ...ship },
    ],
  }) as unknown as Workflow;
const before = { lane: "ship", kind: "approval", decisions: ["approve", "reject"] };

describe("what waits before a command lane", () => {
  it("gives the command's description, its name, and the run's branch", () => {
    expect(aheadOf(flow({ with: { command: "ship" } }), before, "factor/r1")).toEqual({
      lane: "Ship it",
      command: "ship",
      description: "Pushes the branch and opens a pull request.",
      branch: "factor/r1",
    });
  });
  it("says there is no description for a command that has none, and does not show shell text", () => {
    const raw = aheadOf(flow({ with: { run: "git push --force origin HEAD" } }), before, "b");
    expect(raw).toMatchObject({ command: "Ship it", description: null });
    expect(JSON.stringify(raw)).not.toContain("git push");
    expect(aheadOf(flow({ with: { command: "other" } }), before, "b")).toMatchObject({
      command: "other",
      description: null,
    });
  });
  it("is nothing for work that can be sent back, a question, an agent lane or an unknown lane", () => {
    const w = flow({ with: { command: "ship" } });
    expect(aheadOf(w, { ...before, decisions: ["approve", "reject", "send-back"] }, "b")).toBeUndefined();
    expect(aheadOf(w, { ...before, kind: "question", decisions: ["answer"] }, "b")).toBeUndefined();
    expect(aheadOf(w, { ...before, lane: "build" }, "b")).toBeUndefined();
    expect(aheadOf(w, { ...before, lane: "gone" }, "b")).toBeUndefined();
    expect(aheadOf(undefined, before, "b")).toBeUndefined();
  });
});
