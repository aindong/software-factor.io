import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLane, commitFile, flowRepo, promptsOf, runRow, trail } from "../helpers/repo.ts";

const handoff = (extra: Record<string, unknown>) => ({
  handoff: { outcome: "pass", summary: "Did the work.", ...extra },
});

describe("a hand-off whose claims have evidence", () => {
  const repo = flowRepo({
    lanes: [
      agentLane("build", {
        agent: { access: "write" },
        gates: ["verify"],
        on: { pass: "review", fail: "@stop" },
      }),
      agentLane("review", { agent: { role: "reviewer" } }),
    ],
    scripts: {
      author: {
        build: [
          ...commitFile("src/feature.txt"),
          { attach: { name: "before.txt", content: "what the screen showed before\n" } },
          handoff({
            claims: [
              { text: "The feature file exists.", evidence: ["file:src/feature.txt"] },
              { text: "The screen was checked before the change.", evidence: ["attached:before.txt"] },
            ],
            open: ["The copy on the button is a guess."],
          }),
        ],
      },
      reviewer: {
        review: [
          handoff({
            summary: "Read the change.",
            claims: [{ text: "The suite passed on this change.", evidence: ["gate:build.verify"] }],
          }),
        ],
      },
    },
  });
  const run = repo.sf("run");

  it("is accepted, and the run goes on", () => {
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(trail(repo)).toEqual(["build:pass", "review:pass"]);
  });

  it("has each claim recorded with its evidence resolved", () => {
    const claims = repo.rows<{ lane: string; text: string; evidence: string }>(
      "select lane_runs.lane, claims.text, claims.evidence from claims join lane_runs on lane_runs.id = claims.lane_run_id order by claims.id",
    );
    expect(claims.map((c) => `${c.lane}: ${c.text}`)).toEqual([
      "build: The feature file exists.",
      "build: The screen was checked before the change.",
      "review: The suite passed on this change.",
    ]);
    for (const c of claims)
      for (const e of JSON.parse(c.evidence)) expect(e.ok, `${c.text} ${e.ref}`).toBe(true);
  });

  it("has the attached file copied into the run's evidence, with its hash", () => {
    const attached = repo
      .rows<{ evidence: string }>("select evidence from claims")
      .flatMap((c) => JSON.parse(c.evidence) as { ref: string; path?: string; sha256?: string }[])
      .find((e) => e.ref === "attached:before.txt");
    expect(attached?.path?.startsWith(`.factor/runs/${runRow(repo)?.id}/evidence/`)).toBe(true);
    const file = readFileSync(join(repo.dir, attached?.path ?? ""));
    expect(file.toString()).toBe("what the screen showed before\n");
    expect(createHash("sha256").update(file).digest("hex")).toBe(attached?.sha256);
  });

  it("is passed on: the next lane's prompt holds the summary and what is still open", () => {
    const prompt = promptsOf(repo, "review")[0] ?? "";
    expect(prompt).toContain("Did the work.");
    expect(prompt).toContain("The copy on the button is a guess.");
  });

  it("accepts a commit of the run as evidence", () => {
    const other = flowRepo({
      lanes: [agentLane("build", { agent: { access: "write" }, gates: ["verify"] })],
      scripts: {
        author: {
          build: [
            ...commitFile("a.txt"),
            handoff({ claims: [{ text: "Committed.", evidence: ["commit:HEAD"] }] }),
          ],
        },
      },
    });
    expect(other.sf("run").status).toBe(0);
  });
});
