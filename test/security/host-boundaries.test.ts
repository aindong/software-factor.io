import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fakeAgent } from "../../src/core/agents/fake.ts";
import { saveEvidence } from "../../src/core/evidence.ts";
import { gitConfigFingerprint } from "../../src/core/git.ts";
import { passingScript, readyRepo } from "../helpers/repo.ts";

// Found by the security review of the tracer bullet. The rule behind all of them: nothing an agent
// commits or leaves behind, and nothing in a task's text, may change what the host runs or where it writes.
describe("what an agent cannot do to the host", () => {
  it("cannot delete outside its worktree", async () => {
    const root = mkdtempSync(join(tmpdir(), "sf-"));
    const cwd = join(root, "wt");
    mkdirSync(cwd);
    mkdirSync(join(root, "victim"));
    const agent = fakeAgent({ adapter: "fake", script: { "*": [{ delete: "../victim" }] } });
    await agent
      .run({
        runId: "r",
        lane: { id: "w" } as never,
        cwd,
        prompt: "",
        handoffPath: join(root, "h"),
        evidenceDir: join(root, "e"),
        laneDir: root,
        hostDir: root,
        env: {},
        entry: 0,
        signal: new AbortController().signal,
      })
      .catch(() => {});
    expect(existsSync(join(root, "victim"))).toBe(true);
  });

  it("cannot write through a symlink that leaves its worktree", async () => {
    const root = mkdtempSync(join(tmpdir(), "sf-"));
    const cwd = join(root, "wt");
    mkdirSync(cwd);
    mkdirSync(join(root, "outside"));
    symlinkSync(join(root, "outside"), join(cwd, "out"));
    const agent = fakeAgent({
      adapter: "fake",
      script: { "*": [{ write: { path: "out/planted.txt", content: "x" } }] },
    });
    await agent
      .run({
        runId: "r",
        lane: { id: "w" } as never,
        cwd,
        prompt: "",
        handoffPath: join(root, "h"),
        evidenceDir: join(root, "e"),
        laneDir: root,
        hostDir: root,
        env: {},
        entry: 0,
        signal: new AbortController().signal,
      })
      .catch(() => {});
    expect(existsSync(join(root, "outside", "planted.txt"))).toBe(false);
  });

  it("cannot have the gate test a commit that is not on the run's branch", () => {
    const repo = readyRepo({ verify: "test -f proof.txt", script: [] });
    repo.git("checkout", "-q", "-b", "good");
    repo.write("proof.txt", "x\n");
    repo.git("add", "proof.txt");
    repo.git("commit", "-q", "-m", "good");
    repo.git("checkout", "-q", "main");
    repo.git("worktree", "add", "-q", join(repo.home, "good"), "good");
    // the agent repoints its worktree at another checkout that already has the proof
    const script = [
      { write: { path: ".git", content: `gitdir: ${repo.dir}/.git/worktrees/good\n` } },
      { handoff: { outcome: "pass" } },
    ];
    repo.write(
      ".factor/local.json",
      JSON.stringify({ roles: { author: { adapter: "fake", script: { "*": script } } } }),
    );
    expect(repo.sf("run").status).toBe(1);
    expect(repo.rows("select outcome from lane_runs")).toEqual([{ outcome: "fail" }]);
  });

  it("cannot make the host overwrite a file by planting a symlink where evidence goes", () => {
    const root = mkdtempSync(join(tmpdir(), "sf-"));
    const dir = join(root, ".factor/runs/r1/evidence");
    mkdirSync(dir, { recursive: true });
    const victim = join(root, "victim");
    writeFileSync(victim, "safe");
    symlinkSync(victim, join(dir, "a.log"));
    try {
      saveEvidence({ root, runsDir: join(root, ".factor/runs") } as never, "r1", "a.log", "pwned");
    } catch {
      // refusing is the right answer
    }
    expect(readFileSync(victim, "utf8")).toBe("safe");
  });

  it("cannot run code in the host through a git hook, or see the host's environment", () => {
    const repo = readyRepo({ verify: "true", script: passingScript });
    const leak = join(repo.home, "leak.txt");
    writeFileSync(join(repo.dir, ".git/hooks/post-checkout"), `#!/bin/sh\nenv > ${leak}\n`, { mode: 0o755 });
    const run = repo.sf("run");
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(existsSync(leak), "a repository hook ran during the host's git calls").toBe(false);
  });

  it("is noticed when git's configuration changes under the host", () => {
    const repo = readyRepo({ verify: "true", script: passingScript });
    const before = gitConfigFingerprint(repo.dir);
    expect(gitConfigFingerprint(repo.dir)).toBe(before);
    repo.git("config", "filter.x.smudge", "sh -c 'id > /tmp/x'");
    expect(gitConfigFingerprint(repo.dir)).not.toBe(before);
  });

  it("leaves its hand-off outside the repository, and the host keeps its own copy", () => {
    const repo = readyRepo({ verify: "true", script: passingScript });
    expect(repo.sf("run").status).toBe(0);
    const [l] = repo.rows<{ handoff_path: string }>("select handoff_path from lane_runs");
    expect(l?.handoff_path.startsWith(".factor/runs/")).toBe(true);
    expect(JSON.parse(repo.read(l?.handoff_path ?? "")).outcome).toBe("pass");
    const events = repo.rows<{ data: string }>("select data from events where kind = 'lane.agent'");
    const given = JSON.parse(events[0]?.data ?? "{}").handoffPath as string;
    expect(given.startsWith(repo.home), `the agent was told to write ${given}`).toBe(true);
  });
});

describe("what a task's text cannot do", () => {
  it("cannot send control sequences to the terminal", () => {
    const repo = readyRepo({
      verify: "true",
      script: passingScript,
      task: "\u001b]0;spoofed\u0007Title \u001b[2Khidden",
    });
    const run = repo.sf("run");
    const status = repo.sf("status");
    for (const out of [run.stdout, status.stdout]) {
      // biome-ignore lint/suspicious/noControlCharactersInRegex: the test looks for exactly these
      expect(out).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
    }
    expect(status.stdout).toMatch(/Title/);
  });
});
