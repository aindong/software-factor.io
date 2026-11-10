import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLane, commitFile, evidenceOf, flowRepo, pass, runRow } from "../helpers/repo.ts";

const flow = (path: string, gate: Record<string, unknown> = {}, factory: Record<string, unknown> = {}) =>
  flowRepo({
    gates: { protected: { uses: "core/protected-paths@1", onFail: "stop", ...gate } },
    lanes: [agentLane("build", { agent: { access: "write" }, gates: ["protected"] })],
    scripts: { author: { build: [...commitFile(path), pass()] } },
    factory,
  });

describe("the protected-paths gate", () => {
  it.each([
    ".github/workflows/ci.yml",
    ".factor/factory.json",
    "pnpm-lock.yaml",
    ".claude/settings.json",
    "sub/dir/Cargo.lock",
    ".gitattributes",
  ])("stops a run that changes %s", (path) => {
    const repo = flow(path);
    expect(repo.sf("run").status).toBe(1);
    expect(runRow(repo)).toMatchObject({ status: "stopped", stop_code: "gate_stop" });
    expect(repo.rows("select gate, uses, status from gate_results")).toEqual([
      { gate: "protected", uses: "core/protected-paths@1", status: "fail" },
    ]);
    expect(evidenceOf(repo)[0]).toContain(path);
  });

  it("passes a change that touches none", () => {
    const repo = flow("src/feature.ts");
    expect(repo.sf("run").status).toBe(0);
    expect(repo.rows("select status from gate_results")).toEqual([{ status: "pass" }]);
  });

  it("also protects what the workflow and the workspace add", () => {
    const byWorkflow = flow("secrets/prod.txt", { with: { paths: ["secrets/**"] } });
    expect(byWorkflow.sf("run").status).toBe(1);
    const byWorkspace = flow("check.sh", {}, { protectedPaths: ["check.sh"] });
    expect(byWorkspace.sf("run").status).toBe(1);
    expect(evidenceOf(byWorkspace)[0]).toContain("check.sh");
  });

  it("records the tree it checked and a hashed evidence file", () => {
    const repo = flow("src/feature.ts");
    repo.sf("run");
    const [g] = repo.rows<{ tree_hash: string; output_path: string; output_sha256: string }>(
      "select * from gate_results",
    );
    const [r] = repo.rows<{ head_commit: string }>("select head_commit from runs");
    expect(g?.tree_hash).toBe(repo.git("rev-parse", `${r?.head_commit}^{tree}`));
    const file = readFileSync(join(repo.dir, g?.output_path ?? ""));
    expect(createHash("sha256").update(file).digest("hex")).toBe(g?.output_sha256);
  });
});
