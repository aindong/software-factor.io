import { describe, expect, it } from "vitest";
import { agentLane, bind, flowRepo, runRow, standinAccount } from "../helpers/repo.ts";

describe("softwarefactor sessions", () => {
  const repo = flowRepo({
    lanes: [
      agentLane("build", { on: { pass: "review", fail: "@stop" } }),
      agentLane("review", { agent: { role: "reviewer" } }),
    ],
    tasks: "- [ ] First task\n- [ ] Second task\n",
  });
  standinAccount(repo, "claude-a", "claude", { actions: [{ handoff: { outcome: "pass", summary: "ok" } }] });
  standinAccount(repo, "codex-a", "codex", { actions: [{ final: { outcome: "pass", summary: "ok" } }] });
  bind(repo, "author", "claude-a");
  bind(repo, "reviewer", "codex-a"); // no model named: its cost is unknown
  repo.sf("run", "--all");
  const all = repo.sf("sessions");
  const runs = repo.rows<{ id: string }>("select id from runs order by started_at");

  it("prints each session with its lane, account, model, tokens by kind and cost", () => {
    expect(all.status, all.stderr).toBe(0);
    expect(all.stdout).toMatch(/build\s+1\s+claude-a\s+claude-standin-1\s+100\s+50\s+1000\s+200\s+\$0\.4200/);
    expect(all.stdout).toMatch(/review\s+1\s+codex-a\s+-\s+1500\s+300\s+500\s+0\s+unknown/);
  });

  it("prints a total for each run, and says when a cost is left out", () => {
    expect(all.stdout.match(/total\s+1600\s+350\s+1500\s+200\s+\$0\.4200/g)?.length).toBe(2);
    expect(all.stdout).toMatch(/3650 tokens/);
    expect(all.stdout).toMatch(/1 session of unknown cost is not in the total/);
  });

  it("prints a total for each account", () => {
    expect(all.stdout).toMatch(/claude-a\s+2 sessions\s+2700 tokens\s+\$0\.8400/);
    expect(all.stdout).toMatch(/codex-a\s+2 sessions\s+4600 tokens\s+unknown/);
  });

  it("shows one run when it is named, and refuses a run that does not exist", () => {
    const one = repo.sf("sessions", runs[0]?.id ?? "");
    expect(one.stdout).toContain(runs[0]?.id);
    expect(one.stdout).not.toContain(runs[1]?.id);
    const none = repo.sf("sessions", "nope");
    expect(none.status).toBe(1);
    expect(none.stderr).toMatch(/nope/);
  });

  it("says so when nothing has run", () => {
    const empty = flowRepo({ lanes: [agentLane("build")] });
    empty.sf("collect");
    expect(empty.sf("sessions").stdout).toMatch(/No sessions yet/);
    expect(runRow(empty)).toBeUndefined();
  });
});
