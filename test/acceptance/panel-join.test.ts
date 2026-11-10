import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bind,
  flag,
  flowRepo,
  panelLane,
  pass,
  runRow,
  sessionRows,
  standinAccount,
} from "../helpers/repo.ts";

const sensitive = { ref: "change.tier", in: ["sensitive"] };

describe("a lane with a panel", () => {
  const repo = flowRepo({
    lanes: [
      panelLane([
        { id: "logic", prompt: "Look only for logic errors." },
        { id: "needs", prompt: "Check each acceptance criterion." },
        { id: "security", prompt: "Look only for security issues.", when: sensitive },
      ]),
    ],
    scripts: { reviewer: { "*": [{ sleep: 1500 }, pass()] } },
  });
  const started = Date.now();
  const run = repo.sf("run");
  const took = Date.now() - started;
  const prompts = join(repo.dir, ".factor/runs", runRow(repo)?.id ?? "", "prompts");

  it("starts every member whose condition holds, and none whose condition does not", () => {
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(sessionRows(repo, "lane").map((s) => s.lane)).toEqual(["review.logic", "review.needs"]);
    expect(existsSync(join(prompts, "01-review.security.md"))).toBe(false);
  });

  it("starts them at the same time", () => {
    const times = sessionRows(repo, "started_at").map((s) => Date.parse(String(s.started_at)));
    expect(Math.abs((times[0] ?? 0) - (times[1] ?? 0))).toBeLessThan(1000);
    expect(took).toBeLessThan(4500); // two members of 1.5 seconds each, and the command's own start
  });

  it("gives each member the lane's instructions and its own part", () => {
    const logic = repo.read(join(".factor/runs", runRow(repo)?.id ?? "", "prompts", "01-review.logic.md"));
    expect(logic).toContain("Review the change.");
    expect(logic).toContain("Look only for logic errors.");
    expect(logic).not.toContain("Check each acceptance criterion.");
  });

  it("says who reviewed and who was left out", () => {
    expect(run.stdout).toMatch(/review: panel of logic, needs/);
    expect(run.stdout).toMatch(/left out: security/);
  });
});

describe("a member's own settings", () => {
  it("override the lane's: role, tier and effort", () => {
    const repo = flowRepo({
      lanes: [
        panelLane(
          [{ id: "deep" }, { id: "quick", tier: "small", effort: "low" }, { id: "other", role: "author" }],
          { agent: { role: "reviewer", access: "read", prompt: "Review.", tier: "large", effort: "high" } },
        ),
      ],
    });
    const plan = { actions: [{ handoff: { outcome: "pass", summary: "ok" } }] };
    const reviewer = standinAccount(repo, "claude-r", "claude", plan);
    const author = standinAccount(repo, "claude-a", "claude", plan);
    bind(repo, "reviewer", "claude-r", "--large", "opus", "--small", "haiku");
    bind(repo, "author", "claude-a", "--large", "author-model");
    const run = repo.sf("run");
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const byModel = Object.fromEntries(
      reviewer.calls().map((c) => [flag(c.argv, "--model"), flag(c.argv, "--effort")]),
    );
    expect(byModel).toEqual({ opus: "high", haiku: "low" });
    expect(author.calls().map((c) => flag(c.argv, "--model"))).toEqual(["author-model"]);
  });
});
