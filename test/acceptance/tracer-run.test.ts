import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { passingScript, readyRepo } from "../helpers/repo.ts";

describe("one task through one lane", () => {
  const verify = 'test -s hello.txt && echo "cwd=$(pwd -P)"';
  const repo = readyRepo({ verify, script: passingScript });
  const run = repo.sf("run");
  const runs = () =>
    repo.rows<{
      id: string;
      status: string;
      branch: string;
      head_commit: string;
      base_commit: string;
      worktree: string;
    }>("select * from runs");

  it("finishes the task and the run", () => {
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(repo.rows("select title, status from tasks")).toEqual([
      { title: "Add a greeting file", status: "done" },
    ]);
    expect(runs().map((r) => r.status)).toEqual(["done"]);
    expect(repo.rows("select lane, outcome from lane_runs")).toEqual([{ lane: "work", outcome: "pass" }]);
  });

  it("did the work on its own branch, in a worktree outside the repository", () => {
    const [r] = runs();
    expect(r?.worktree.startsWith(repo.home), `worktree ${r?.worktree}`).toBe(true);
    expect(r?.worktree.startsWith(repo.dir)).toBe(false);
    expect(existsSync(join(repo.dir, "hello.txt"))).toBe(false);
    expect(repo.git("show", `${r?.branch}:hello.txt`)).toBe("hello");
    expect(r?.head_commit).toBe(repo.git("rev-parse", r?.branch ?? ""));
    expect(r?.head_commit).not.toBe(r?.base_commit);
    // the repository's own checkout never changed branch: its reflog holds only the two set-up commits
    expect(r?.branch).not.toBe("main");
    expect(repo.git("reflog", "HEAD").split("\n")).toHaveLength(2);
    expect(repo.git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  it("recorded the gate's evidence: command, exit code, tree and a hashed output file", () => {
    const [r] = runs();
    const gates = repo.rows<{
      gate: string;
      command: string;
      exit_code: number;
      status: string;
      tree_hash: string;
      output_path: string;
      output_sha256: string;
    }>("select * from gate_results");
    expect(gates).toHaveLength(1);
    const g = gates[0];
    expect(g).toMatchObject({ gate: "verify", command: verify, exit_code: 0, status: "pass" });
    expect(g?.tree_hash).toBe(repo.git("rev-parse", `${r?.head_commit}^{tree}`));
    expect(g?.output_path.startsWith(".factor/runs/")).toBe(true);
    const output = readFileSync(join(repo.dir, g?.output_path ?? ""));
    expect(createHash("sha256").update(output).digest("hex")).toBe(g?.output_sha256);
    // the file holds what the command really printed, and the command ran in neither the agent's
    // worktree nor the repository itself
    const cwd = /^cwd=(.+)$/m.exec(output.toString())?.[1];
    expect(cwd).toBeTruthy();
    expect(cwd).not.toBe(r?.worktree);
    expect(cwd?.startsWith(repo.dir)).toBe(false);
  });

  it("shows the run in status", () => {
    const status = repo.sf("status");
    expect(status.status).toBe(0);
    expect(status.stdout).toMatch(/Add a greeting file/);
    expect(status.stdout).toMatch(/done/);
    expect(status.stdout).toMatch(/work\s.*pass/);
    expect(status.stdout).toMatch(/verify\s.*pass/);
    const [g] = repo.rows<{ output_path: string }>("select output_path from gate_results");
    expect(status.stdout).toContain(g?.output_path);
  });

  it("does not run a task twice", () => {
    const again = repo.sf("run");
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/no queued task/i);
    expect(repo.rows("select id from runs")).toHaveLength(1);
    expect(repo.rows("select id from tasks")).toHaveLength(1);
  });
});

describe("the claim comes first", () => {
  it("shows the task and the run as running while the gate is still deciding", () => {
    // the verify command reads the factory's own database while it runs
    const repo = readyRepo({ verify: "true", script: passingScript });
    const peek = `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(${JSON.stringify(join(repo.dir, ".factor/state.db"))},{readOnly:true});console.log("during="+d.prepare("select status from tasks").get().status+"/"+d.prepare("select status from runs").get().status)`;
    const factory = repo.json<{ commands: Record<string, string> }>(".factor/factory.json");
    factory.commands.verify = `${process.execPath} -e '${peek}'`;
    repo.write(".factor/factory.json", `${JSON.stringify(factory, null, 2)}\n`);
    repo.git("commit", "-qam", "peek");
    const run = repo.sf("run");
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const [g] = repo.rows<{ output_path: string }>("select output_path from gate_results");
    expect(readFileSync(join(repo.dir, g?.output_path ?? ""), "utf8")).toMatch(/^during=running\/running$/m);
    expect(repo.rows("select status from tasks")).toEqual([{ status: "done" }]);
  });
});
