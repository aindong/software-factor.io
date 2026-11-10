// A skill a workflow names from a repository is installed into the run's worktree with
// `npx skills`, for the agent of the lane that names it, once the person has allowed it here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { calls, edit, standIn } from "../helpers/collect.ts";
import { agentLane, commitFile, flowRepo, pass, type Repo } from "../helpers/repo.ts";

function withSkill(): { repo: Repo; log: string } {
  const repo = flowRepo({
    lanes: [agentLane("build", { agent: { access: "write", skills: ["review"] } })],
    scripts: { author: { build: [...commitFile("notes.txt"), pass()] } },
  });
  edit(repo, (w) => {
    w.skills = { review: { from: "repo", source: "acme/skills", skill: "code-review" } };
  });
  // what `npx skills add` does: it puts the skill under the agent's folder in the project
  const log = standIn(
    repo,
    "npx",
    'mkdir -p .claude/skills/code-review && echo "# Review" > .claude/skills/code-review/SKILL.md && pwd >> "$0.where"',
  );
  return { repo, log };
}

it("does not start a run while a skill from a repository is not allowed on this machine", () => {
  const { repo, log } = withSkill();
  const r = repo.sf("run");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/skill "review" \(acme\/skills, code-review\) is not allowed on this machine/);
  expect(r.stderr).toContain("softwarefactor allow --skill review");
  expect(calls(log)).toEqual([]);
  expect(repo.rows("select id from runs")).toEqual([]);
});

it("installs an allowed skill into the worktree for the lane's agent, and keeps it out of the run's change", () => {
  const { repo, log } = withSkill();
  const allowed = repo.sf("allow", "--skill", "review");
  expect(allowed.status, allowed.stderr).toBe(0);
  expect(allowed.stdout).toContain("acme/skills");
  expect(allowed.stdout).toContain("code-review");
  const r = repo.sf("run");
  expect(repo.rows("select status from runs"), r.stdout + r.stderr).toEqual([{ status: "done" }]);
  expect(calls(log)).toEqual([
    "[--yes][skills@1.7.6][add][acme/skills][-s][code-review][-a][claude-code][-y][--copy]",
  ]);
  const { worktree, branch } = repo.rows<{ worktree: string; branch: string }>(
    "select worktree, branch from runs",
  )[0] ?? { worktree: "", branch: "" };
  expect(readFileSync(join(repo.home, "bin", "npx.where"), "utf8").trim()).toBe(worktree);
  // the agent committed everything it saw: the skill's files are not in the change
  expect(repo.git("show", "--name-only", "--format=", branch).split("\n")).toEqual(["notes.txt"]);
});

it("asks again when the workflow names another source for the skill", () => {
  const { repo } = withSkill();
  expect(repo.sf("allow", "--skill", "review").status).toBe(0);
  edit(repo, (w) => {
    w.skills = { review: { from: "repo", source: "someone-else/skills", skill: "code-review" } };
  });
  const r = repo.sf("run");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/skill "review" .*someone-else\/skills.*has changed since it was allowed/);
});

it("stops the run when the skill cannot be installed, and refuses a source that npx could read as an option", () => {
  const { repo } = withSkill();
  expect(repo.sf("allow", "--skill", "review").status).toBe(0);
  standIn(repo, "npx", "echo 'could not find the skill' >&2; exit 1");
  const r = repo.sf("run");
  expect(r.stdout + r.stderr).toMatch(/skill "review".*could not find the skill/s);
  expect(repo.rows<{ status: string }>("select status from runs").every((x) => x.status !== "done")).toBe(
    true,
  );

  const odd = withSkill().repo;
  edit(odd, (w) => {
    w.skills = { review: { from: "repo", source: "--registry=https://example.com", skill: "code-review" } };
  });
  const refused = odd.sf("allow", "--skill", "review");
  expect(refused.status).toBe(1);
  expect(refused.stderr).toMatch(/source/);
});
