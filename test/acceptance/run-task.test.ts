// `softwarefactor run --task <words>` takes a named task from the queue, not the oldest one.
import { expect, it } from "vitest";
import { passingScript, type Repo, readyRepo } from "../helpers/repo.ts";

function threeTasks(): Repo {
  const repo = readyRepo({ verify: "true", script: passingScript });
  repo.write(
    ".factor/tasks.md",
    "# Tasks\n\n- [ ] Add a greeting file\n- [ ] Fix the date format\n- [ ] Fix the date picker\n",
  );
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "three tasks");
  expect(repo.sf("collect").status).toBe(0);
  return repo;
}
const states = (repo: Repo) =>
  Object.fromEntries(
    repo
      .rows<{ title: string; status: string }>("select title, status from tasks")
      .map((t) => [t.title, t.status]),
  );

it("runs the task whose title holds the words, and leaves the older ones queued", () => {
  const repo = threeTasks();
  const run = repo.sf("run", "--task", "date FORMAT");
  expect(run.status, run.stdout + run.stderr).toBe(0);
  expect(states(repo)).toEqual({
    "Add a greeting file": "queued",
    "Fix the date format": "done",
    "Fix the date picker": "queued",
  });
}, 120_000);

it("takes a task by its key", () => {
  const repo = threeTasks();
  const key =
    repo.rows<{ key: string }>("select key from tasks where title = 'Fix the date picker'")[0]?.key ?? "";
  const run = repo.sf("run", "--task", key);
  expect(run.status, run.stdout + run.stderr).toBe(0);
  expect(states(repo)["Fix the date picker"]).toBe("done");
}, 120_000);

it("starts nothing when the words fit two queued tasks, and names them", () => {
  const repo = threeTasks();
  const run = repo.sf("run", "--task", "fix the date");
  expect(run.status).not.toBe(0);
  expect(run.stdout + run.stderr).toMatch(/Fix the date format[\s\S]*Fix the date picker/);
  expect(Object.values(states(repo))).toEqual(["queued", "queued", "queued"]);
});

it("starts nothing when no queued task fits", () => {
  const repo = threeTasks();
  const run = repo.sf("run", "--task", "no such thing");
  expect(run.status).not.toBe(0);
  expect(run.stdout + run.stderr).toMatch(/No queued task/);
  expect(Object.values(states(repo))).toEqual(["queued", "queued", "queued"]);
});
