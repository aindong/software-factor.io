import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLane, flowRepo, panelLane, pass, promptsOf, runRow, sessionRows } from "../helpers/repo.ts";

const claim = (text: string) => ({ text, evidence: ["file:README.md"] });

describe("what a panel leaves", () => {
  const findings = { findings: { type: "array", description: "Every finding." } };
  const repo = flowRepo({
    lanes: [
      panelLane([{ id: "logic" }, { id: "needs" }], {
        outputs: findings,
        on: { pass: "after", fail: "@stop" },
      }),
      agentLane("after", { inputs: { found: "review.outputs.findings" } }),
    ],
    scripts: {
      reviewer: {
        "review.logic": [
          { usage: { tokens: 100 } },
          { sleep: 400 }, // it ends last: the lists are still joined in the order of the members
          pass({
            summary: "The logic holds.",
            outputs: { findings: ["a"] },
            claims: [claim("The logic holds.")],
          }),
        ],
        "review.needs": [
          { usage: { tokens: 50 } },
          pass({
            summary: "All criteria met.",
            outputs: { findings: ["b", "c"] },
            claims: [claim("All met.")],
          }),
        ],
      },
    },
  });
  const run = repo.sf("run");
  const id = runRow(repo)?.id ?? "";

  it("is a session and a checked hand-off for each member", () => {
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(sessionRows(repo).slice(0, 2)).toEqual([
      { lane: "review.logic", tokens: 100 },
      { lane: "review.needs", tokens: 50 },
    ]);
    for (const member of ["logic", "needs"]) {
      expect(existsSync(join(repo.dir, ".factor/runs", id, "handoffs", `01-review.${member}.json`))).toBe(
        true,
      );
    }
  });

  it("records what each member claimed", () => {
    const claims = repo.rows<{ text: string }>("select text from claims order by text").map((c) => c.text);
    expect(claims).toEqual(["All met.", "The logic holds."]);
  });

  it("is one lane run, with the members' tokens added up", () => {
    expect(repo.rows("select lane, tokens from lane_runs order by id")[0]).toEqual({
      lane: "review",
      tokens: 150,
    });
    expect(JSON.parse(runRow(repo)?.state ?? "{}").spent.tokens).toBe(150);
  });

  it("joins the members' lists into the lane's output", () => {
    const state = JSON.parse(runRow(repo)?.state ?? "{}");
    expect(state.outputs.review.findings).toEqual(["a", "b", "c"]);
    expect(promptsOf(repo, "after")[0]).toContain('found: ["a","b","c"]');
  });

  it("hands the next lane each member's verdict, as agents' words", () => {
    const prompt = promptsOf(repo, "after")[0] ?? "";
    expect(prompt).toContain("> logic: pass. The logic holds.");
    expect(prompt).toContain("> needs: pass. All criteria met.");
  });
});
