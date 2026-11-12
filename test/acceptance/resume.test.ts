// A run that stopped on its budget carries on from the lane it had reached once the budget is
// raised: `softwarefactor resume <run>`. Nothing is run again, and no new task is taken.
import { expect, it } from "vitest";
import { agentLane, flowRepo, pass, type Repo, trail } from "../helpers/repo.ts";

function overBudget(): { repo: Repo; id: string } {
  const repo = flowRepo({
    lanes: [agentLane("build", { on: { pass: "review", fail: "@stop" } }), agentLane("review")],
    limits: { minutes: 60, tokens: 1000 },
    scripts: { author: { build: [{ usage: { tokens: 5000 } }, pass()] } },
    tasks: "- [ ] One\n- [ ] Two\n",
  });
  const run = repo.sf("run");
  expect(run.stdout + run.stderr).toMatch(/used its budget of 1000 tokens, before lane "review"/);
  const id = repo.rows<{ id: string }>("select id from runs")[0]?.id ?? "";
  return { repo, id };
}
function raise(repo: Repo, tokens: number): void {
  const w = repo.json<{ limits: { tokens: number } }>(".factor/workflows/starter.json");
  w.limits.tokens = tokens;
  repo.write(".factor/workflows/starter.json", `${JSON.stringify(w, null, 2)}\n`);
}
const tasks = (repo: Repo) =>
  Object.fromEntries(
    repo
      .rows<{ title: string; status: string }>("select title, status from tasks")
      .map((t) => [t.title, t.status]),
  );

it("carries a run on from the lane it had reached, and takes no new task", () => {
  const { repo, id } = overBudget();
  raise(repo, 1_000_000);
  const resume = repo.sf("resume", id);
  expect(resume.status, resume.stdout + resume.stderr).toBe(0);
  expect(resume.stdout).toMatch(new RegExp(`run ${id}.*carr(y|ies) on.*"review"`));
  expect(trail(repo)).toEqual(["build:pass", "review:pass"]);
  expect(repo.rows<{ status: string }>("select status from runs")).toEqual([{ status: "done" }]);
  expect(tasks(repo)).toEqual({ One: "done", Two: "queued" });
}, 120_000);

it("refuses while the budget is still used up, and says which limit to raise", () => {
  const { repo, id } = overBudget();
  const resume = repo.sf("resume", id);
  expect(resume.status).not.toBe(0);
  expect(resume.stdout + resume.stderr).toMatch(/limits\.tokens/);
  expect(repo.rows<{ status: string }>("select status from runs")).toEqual([{ status: "stopped" }]);
}, 120_000);

it("refuses a run that did not stop on its budget, and one that is not there", () => {
  const repo = flowRepo({ lanes: [agentLane("build")] });
  expect(repo.sf("run").status).toBe(0);
  const id = repo.rows<{ id: string }>("select id from runs")[0]?.id ?? "";
  const done = repo.sf("resume", id);
  expect(done.status).not.toBe(0);
  expect(done.stdout + done.stderr).toMatch(/done/);
  const none = repo.sf("resume", "nosuchrun");
  expect(none.status).not.toBe(0);
  expect(none.stdout + none.stderr).toMatch(/no run/i);
}, 120_000);
