import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentLane,
  bind,
  editWorkflow,
  flowRepo,
  panelLane,
  runRow,
  standinAccount,
} from "../helpers/repo.ts";

const ok = { outcome: "pass", summary: "ok" };
const start = () => {
  const repo = flowRepo({
    lanes: [
      agentLane("build", { on: { pass: "review", fail: "@stop" } }),
      panelLane([{ id: "logic" }, { id: "needs" }]),
    ],
  });
  editWorkflow(repo, (w) => {
    Object.assign((w.roles as Record<string, object>).reviewer ?? {}, { differentVendorFrom: ["author"] });
  });
  return repo;
};
const report = (repo: ReturnType<typeof flowRepo>) =>
  readFileSync(join(repo.dir, ".factor/runs", runRow(repo)?.id ?? "", "handoff.md"), "utf8");

describe("reviewers and the author's vendor", () => {
  it("run on the same vendor when that is how they are bound, and the run says so", () => {
    const repo = start();
    standinAccount(repo, "claude-a", "claude", { actions: [{ final: ok }] });
    standinAccount(repo, "claude-b", "claude", { actions: [{ final: ok }] });
    bind(repo, "author", "claude-a");
    bind(repo, "reviewer", "claude-b");
    const run = repo.sf("run");
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toMatch(/review: .*same vendor as "author" \(claude\)/);
    expect(report(repo)).toMatch(/same vendor/);
  });

  it("run on another vendor when one is bound: the author on one CLI, every member on the other", () => {
    const repo = start();
    const claude = standinAccount(repo, "claude-a", "claude", { actions: [{ final: ok }] });
    const codex = standinAccount(repo, "codex-a", "codex", { actions: [{ final: ok }] });
    bind(repo, "author", "claude-a");
    bind(repo, "reviewer", "codex-a");
    const run = repo.sf("run");
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).not.toMatch(/same vendor/);
    expect(report(repo)).not.toMatch(/same vendor/);
    expect(claude.calls().length).toBe(1);
    const servers = codex.calls().map((c) => {
      const found = c.argv.find((a) => a.startsWith("mcp_servers.factor.args=")) ?? "=[]";
      const args: string[] = JSON.parse(found.slice(found.indexOf("=") + 1));
      return { lane: args[args.indexOf("--lane") + 1], dir: args[args.indexOf("--lane-dir") + 1] };
    });
    expect(servers.map((s) => s.lane).sort()).toEqual(["review.logic", "review.needs"]);
    expect(new Set(servers.map((s) => s.dir)).size).toBe(2); // a folder of its own for each
  });

  it("say nothing about vendors for the scripted agent", () => {
    const repo = start();
    expect(repo.sf("run").stdout).not.toMatch(/same vendor/);
  });
});
