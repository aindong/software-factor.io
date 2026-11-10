import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLane, commitFile, flowRepo, runRow } from "../helpers/repo.ts";

const handoff = (extra: Record<string, unknown> = {}) => ({
  handoff: { outcome: "pass", summary: "Did the work.", ...extra },
});
const riskOf = (repo: ReturnType<typeof flowRepo>) =>
  JSON.parse(repo.rows<{ risk: string | null }>("select risk from runs")[0]?.risk ?? "null");
const two = (build: unknown, review: unknown, file = "src/a.txt") =>
  flowRepo({
    lanes: [
      agentLane("build", {
        agent: { access: "write" },
        gates: ["verify"],
        on: { pass: "review", fail: "@stop" },
      }),
      agentLane("review", { agent: { role: "reviewer" } }),
    ],
    scripts: { author: { build: [...commitFile(file), build] }, reviewer: { review: [review] } },
  });

describe("the risk of a run", () => {
  it("is the highest level a lane stated", () => {
    const repo = two(
      handoff({ risk: { level: "low", door: "two-way", why: "A new file." } }),
      handoff({ risk: { level: "high", door: "two-way", why: "It touches the login path." } }),
    );
    repo.sf("run");
    expect(riskOf(repo)).toMatchObject({ level: "high", door: "two-way" });
  });

  it("is raised from low for a one-way door, and says why", () => {
    const repo = two(
      handoff({ risk: { level: "low", door: "one-way", why: "It drops a column." } }),
      handoff(),
    );
    repo.sf("run");
    const risk = riskOf(repo);
    expect(risk).toMatchObject({ level: "medium", door: "one-way" });
    expect(risk.raised.join(" ")).toMatch(/one-way/);
  });

  it("is raised from low for a sensitive change", () => {
    const repo = two(
      handoff({ risk: { level: "low", door: "two-way", why: "Small." } }),
      handoff(),
      "src/auth/session.ts",
    );
    repo.sf("run");
    expect(riskOf(repo)).toMatchObject({ level: "medium" });
    expect(riskOf(repo).raised.join(" ")).toMatch(/sensitive/);
  });

  it("reads not assessed when no lane stated one", () => {
    const repo = two(handoff(), handoff());
    repo.sf("run");
    expect(riskOf(repo)).toBeNull();
    expect(repo.sf("status").stdout).toMatch(/risk: not assessed/);
  });
});

describe("the hand-off to a person", () => {
  it("is written when a run stops: lanes, evidence, what is open, the risk, and why it stopped", () => {
    const repo = flowRepo({
      commands: { verify: "false" },
      lanes: [
        agentLane("plan", { on: { pass: "build", fail: "@stop" } }),
        agentLane("build", { agent: { access: "write" }, gates: ["verify"] }),
      ],
      scripts: {
        author: {
          plan: [
            handoff({
              summary: "Planned two steps.",
              open: ["Which date format?"],
              risk: { level: "medium", door: "two-way", why: "It changes a public page." },
            }),
          ],
          build: [...commitFile("a.txt"), handoff({ summary: "Built step one." })],
        },
      },
    });
    expect(repo.sf("run").status).toBe(1);
    const path = join(repo.dir, ".factor/runs", runRow(repo)?.id ?? "", "handoff.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    for (const want of [
      "plan",
      "Planned two steps.",
      "build",
      "Built step one.",
      "verify",
      "fail",
      "Which date format?",
      "medium",
      "lane_failed",
      "evidence/",
    ]) {
      expect(text, `missing: ${want}`).toContain(want);
    }
    expect(repo.sf("status").stdout).toContain(`.factor/runs/${runRow(repo)?.id}/handoff.md`);
  });

  it("is written when a run waits for approval", () => {
    const repo = flowRepo({
      lanes: [agentLane("work", { checkpoint: "in" })],
      scripts: { author: { work: [handoff({ summary: "Ready to look at." })] } },
    });
    expect(repo.sf("run").status).toBe(3);
    const text = readFileSync(join(repo.dir, ".factor/runs", runRow(repo)?.id ?? "", "handoff.md"), "utf8");
    expect(text).toContain("Ready to look at.");
    expect(text).toContain("awaiting_approval");
  });
});
