// From the correctness review of task 19.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { expect, it } from "vitest";
import { edit, standIn } from "../helpers/collect.ts";
import { flow, lock, makePlugin, useFlow } from "../helpers/plugin.ts";
import { agentLane, commandLane, commitFile, flowRepo, pass } from "../helpers/repo.ts";

it("keeps a file the skills installer leaves at the top of the worktree out of the run's change", () => {
  const repo = flowRepo({
    lanes: [agentLane("build", { agent: { access: "write", skills: ["review"] }, gates: ["verify"] })],
    scripts: { author: { build: [...commitFile("notes.txt"), pass()] } },
  });
  edit(repo, (w) => {
    w.skills = { review: { from: "repo", source: "acme/skills", skill: "code-review" } };
  });
  standIn(
    repo,
    "npx",
    'mkdir -p .claude/skills/code-review && echo "# Review" > .claude/skills/code-review/SKILL.md && echo "{}" > skills-lock.json',
  );
  expect(repo.sf("allow", "--skill", "review").status).toBe(0);
  repo.sf("run");
  const branch = repo.rows<{ branch: string }>("select branch from runs")[0]?.branch ?? "";
  expect(repo.git("diff", "--name-only", "main", branch).split("\n")).toEqual(["notes.txt"]);
  // and a second run does not write the same lines again
  const exclude = repo.read(".git/info/exclude");
  repo.write(".factor/tasks.md", "- [ ] Do the thing\n- [ ] Another thing\n");
  repo.sf("run");
  expect(repo.read(".git/info/exclude")).toBe(exclude);
});

it("installs what the lock pins when the plugin was added by a relative folder from a subfolder", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const plugin = makePlugin();
  const sub = join(repo.dir, "sub");
  mkdirSync(sub);
  const added = spawnSync(
    process.execPath,
    [resolve("dist/cli.js"), "add", relative(sub, plugin.dir), "--yes"],
    {
      cwd: sub,
      encoding: "utf8",
      env: { ...process.env, FACTOR_HOME: repo.home, NO_COLOR: "1" },
    },
  );
  expect(added.status, added.stderr).toBe(0);
  rmSync(join(repo.home, "plugins"), { recursive: true });
  const r = repo.sf("add", "--yes"); // from the repository's root
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
});

it("refuses a plugin's workflow that keeps its instructions in a file beside it: only the workflow is copied", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const wf = flow();
  const build = (wf.lanes as { agent?: { prompt: unknown } }[])[1];
  if (build?.agent) build.agent.prompt = { file: "prompts/build.md" };
  const plugin = makePlugin(() => {}, {
    "workflows/acme-flow.json": JSON.stringify(wf),
    "workflows/prompts/build.md": "Build it.\n",
  });
  const added = repo.sf("add", plugin.dir, "--yes");
  expect(added.status).toBe(1);
  expect(added.stderr).toMatch(/acme-flow.*prompt/s);
  expect(lock(repo)).toEqual({});
});

it.each([
  ["^1.5.0", /\^1\.5\.0.*1\.2\.0/],
  ["~1.1.0", /~1\.1\.0.*1\.2\.0/],
  [">=1.0.0 <2", /is not a range the factory reads/],
  ["latest", /is not a range the factory reads/],
] as const)("refuses the range %s for 1.2.0, and says why", (range, said) => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  expect(repo.sf("add", makePlugin().dir, "--yes").status).toBe(0);
  useFlow(repo, (w) => {
    w.plugins = { acme: range };
  });
  const r = repo.sf("run");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(said);
});

it("refuses --hash when no source is named, and a lock that is not JSON, without rewriting it", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  expect(repo.sf("add", makePlugin().dir, "--yes").status).toBe(0);
  expect(repo.sf("add", "--yes", "--hash", "0".repeat(64)).status).toBe(1);
  const broken = "<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> theirs\n";
  repo.write(".factor/plugins.lock.json", broken);
  const r = repo.sf("add", makePlugin().dir, "--yes");
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/plugins\.lock\.json/);
  expect(repo.read(".factor/plugins.lock.json")).toBe(broken);
});
