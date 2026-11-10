import { describe, expect, it } from "vitest";
import {
  agentLane,
  bind,
  editWorkflow,
  flowRepo,
  panelLane,
  runRow,
  sessionRows,
  standinAccount,
  trail,
} from "../helpers/repo.ts";

const pass = { actions: [{ handoff: { outcome: "pass", summary: "ok" } }] };

describe("a panel member's role", () => {
  it("must be bound: the run is refused before any task is taken", () => {
    const repo = flowRepo({ lanes: [panelLane([{ id: "logic" }, { id: "audit", role: "auditor" }])] });
    editWorkflow(repo, (w) => {
      (w.roles as Record<string, object>).auditor = { description: "Audits." };
    });
    const run = repo.sf("run");
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/auditor/);
    expect(repo.sf("status").stdout).not.toMatch(/running|stopped/);
  });
});

describe("a panel member's account", () => {
  it("holds the whole panel when it is near its limit", () => {
    const repo = flowRepo({
      lanes: [
        agentLane("build", { on: { pass: "review", fail: "@stop" } }),
        panelLane([{ id: "logic" }, { id: "audit", role: "author" }]),
      ],
    });
    // each stand-in run reports 1350 tokens: the build lane takes the author's account past its headroom
    standinAccount(repo, "claude-a", "claude", pass, ["--limit", "5h=1500", "--headroom", "0.8"]);
    standinAccount(repo, "claude-r", "claude", pass);
    bind(repo, "author", "claude-a");
    bind(repo, "reviewer", "claude-r");
    expect(repo.sf("run").status).toBe(3);
    expect(runRow(repo)).toMatchObject({ status: "waiting", stop_code: "account_limit" });
    expect(trail(repo)).toEqual(["build:pass"]);
    expect(sessionRows(repo).length).toBe(1); // no member was started
  });
});
