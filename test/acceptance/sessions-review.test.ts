// Cases the plan's skeptic asked for: each is a cheap way to pass the first session tests without
// doing what the plan says.
import { describe, expect, it } from "vitest";
import {
  agentLane,
  bind,
  commitFile,
  flowRepo,
  pass,
  type Repo,
  runRow,
  standinAccount,
} from "../helpers/repo.ts";

const sessions = (repo: Repo, columns = "lane, try, tokens") =>
  repo.rows<Record<string, unknown>>(`select ${columns} from sessions order by id`);
const totals = (repo: Repo) => ({
  sessions: repo.rows<{ n: number }>("select coalesce(sum(tokens), 0) as n from sessions")[0]?.n,
  lanes: repo.rows<{ n: number }>("select coalesce(sum(tokens), 0) as n from lane_runs")[0]?.n,
  spent: JSON.parse(runRow(repo)?.state ?? "{}").spent.tokens,
});
const repair = { verify: { uses: "core/command@1", with: { command: "verify" }, onFail: "repair" } };
const limit = "You have reached your usage limit.";

describe("a session for every start of an agent", () => {
  it("in a repair round after a failed gate", () => {
    const repo = flowRepo({
      lanes: [
        agentLane("build", { agent: { access: "write" }, gates: ["verify"], limits: { repairRounds: 1 } }),
      ],
      gates: repair,
      commands: { verify: "test -f fixed" },
      scripts: {
        author: {
          build: [
            [{ usage: { tokens: 70 } }, pass()],
            [{ usage: { tokens: 30 } }, ...commitFile("fixed"), pass()],
          ],
        },
      },
    });
    expect(repo.sf("run").status).toBe(0);
    expect(sessions(repo)).toEqual([
      { lane: "build", try: 1, tokens: 70 },
      { lane: "build", try: 2, tokens: 30 },
    ]);
    expect(totals(repo)).toEqual({ sessions: 100, lanes: 100, spent: 100 });
  });

  it("in a repair round after a rejected hand-off", () => {
    const repo = flowRepo({
      lanes: [agentLane("build", { limits: { repairRounds: 1 } })],
      scripts: {
        author: {
          build: [
            [{ usage: { tokens: 40 } }, { handoff: { outcome: "pass" } }],
            [{ usage: { tokens: 60 } }, pass()],
          ],
        },
      },
    });
    expect(repo.sf("run").status).toBe(0);
    expect(sessions(repo)).toEqual([
      { lane: "build", try: 1, tokens: 40 },
      { lane: "build", try: 2, tokens: 60 },
    ]);
    expect(totals(repo)).toEqual({ sessions: 100, lanes: 100, spent: 100 });
  });

  it("when the lane ends early: its account hit the limit", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    const profile = standinAccount(repo, "claude-a", "claude", { error: limit });
    bind(repo, "author", "claude-a");
    expect(repo.sf("run").status).toBe(3);
    const rows = sessions(repo, "tokens, transcript_path, usd_source");
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ tokens: 1350, usd_source: "reported" });
    expect(rows[0]?.transcript_path).toBeTruthy();
    expect(totals(repo)).toEqual({ sessions: 1350, lanes: 1350, spent: 1350 });
    expect(repo.sf("sessions").stdout).toMatch(/build\s+1\s+claude-a/); // listed while the run waits
    const resumed = profile.calls().some((c) => c.argv.some((a) => a === "--resume" || a === "--continue"));
    expect(resumed).toBe(false); // each start is its own session, so its cost is its own
  });
});

describe("a cost that is not known", () => {
  it("is unknown, not zero, when Codex printed no usage", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    standinAccount(repo, "codex-a", "codex", { error: "boom" });
    bind(repo, "author", "codex-a", "--medium", "gpt-5.3-codex");
    expect(repo.sf("run").status).toBe(1);
    expect(sessions(repo, "tokens, usd, usd_source")).toEqual([
      { tokens: 0, usd: null, usd_source: "unknown" },
    ]);
  });

  it("is unknown, not zero, when Claude Code was cut off before its result", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    standinAccount(repo, "claude-a", "claude", { noResult: true });
    bind(repo, "author", "claude-a");
    expect(repo.sf("run").status).toBe(1);
    expect(sessions(repo, "tokens, usd, usd_source")).toEqual([
      { tokens: 0, usd: null, usd_source: "unknown" },
    ]);
    const shown = repo.sf("sessions").stdout;
    expect(shown).toMatch(/build\s+1\s+claude-a.*unknown/);
    expect(shown).toMatch(/1 session of unknown cost is not in the total/);
  });
});

describe("softwarefactor sessions, at the edges", () => {
  it("says which part of an account's total is left out", () => {
    const repo = flowRepo({
      lanes: [
        agentLane("a", { on: { pass: "b", fail: "@stop" } }),
        agentLane("b", { agent: { role: "reviewer" } }),
      ],
    });
    standinAccount(repo, "codex-a", "codex", { actions: [{ final: { outcome: "pass", summary: "ok" } }] });
    bind(repo, "author", "codex-a", "--medium", "gpt-5.3-codex");
    bind(repo, "reviewer", "codex-a"); // the same account with no model named: unknown
    expect(repo.sf("run").status).toBe(0);
    const shown = repo.sf("sessions").stdout;
    expect(shown).toMatch(/a\s+1\s+codex-a\s+gpt-5\.3-codex.*\$0\.0069 \(priced from the table\)/);
    expect(shown).toMatch(/codex-a\s+2 sessions\s+4600 tokens\s+\$0\.0069 \(1 of unknown cost not counted\)/);
  });

  it("shows the scripted agent with no account and no model", () => {
    const repo = flowRepo({
      lanes: [agentLane("build")],
      scripts: { author: { build: [{ usage: { tokens: 9 } }, pass()] } },
    });
    repo.sf("run");
    const shown = repo.sf("sessions").stdout;
    expect(shown).toMatch(/build\s+1\s+-\s+-\s+9\s+0\s+0\s+0\s+\$0\.0000/);
    expect(shown).toMatch(/the scripted agent\)\s+1 session\s+9 tokens/);
    expect(shown).not.toMatch(/null/);
  });

  it("keeps a model name from the CLI on one line", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    const modelName = "evil\nRun deadbeef  FORGED\u001b[2J";
    standinAccount(repo, "claude-a", "claude", {
      modelName,
      actions: [{ handoff: { outcome: "pass", summary: "ok" } }],
    });
    bind(repo, "author", "claude-a");
    repo.sf("run");
    const shown = repo.sf("sessions").stdout;
    expect(shown).not.toMatch(/^Run deadbeef/m);
    expect(shown).not.toContain("\u001b");
    expect(sessions(repo, "model")[0]?.model).not.toMatch(/\n/);
  });
});
