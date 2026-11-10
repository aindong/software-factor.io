import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentLane,
  commandLane,
  commitFile,
  flowRepo,
  pass,
  promptsOf,
  runRow,
  trail,
} from "../helpers/repo.ts";

const approvalFlow = () =>
  flowRepo({
    lanes: [agentLane("work", { agent: { access: "write" }, gates: ["verify"], checkpoint: "in" })],
    scripts: {
      author: {
        work: [
          [...commitFile("a.txt"), pass()],
          [...commitFile("b.txt"), pass()],
        ],
      },
    },
  });

describe("a person's decision", () => {
  it("is listed in the inbox with the run and the lane", () => {
    const repo = approvalFlow();
    expect(repo.sf("run").status).toBe(3);
    const inbox = repo.sf("inbox");
    expect(inbox.status).toBe(0);
    expect(inbox.stdout).toContain(runRow(repo)?.id);
    expect(inbox.stdout).toMatch(/work/);
    expect(inbox.stdout).toMatch(/approval/);
  });

  it("approve: the run continues", () => {
    const repo = approvalFlow();
    repo.sf("run");
    const r = repo.sf("approve", runRow(repo)?.id ?? "");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(runRow(repo)).toMatchObject({ status: "done", stop_code: "done" });
    expect(repo.rows("select status from inbox")).toEqual([{ status: "approved" }]);
    expect(repo.rows("select status from tasks")).toEqual([{ status: "done" }]);
  });

  it("reject: the lane's fail transition is taken", () => {
    const repo = approvalFlow();
    repo.sf("run");
    expect(repo.sf("reject", runRow(repo)?.id ?? "", "--note", "wrong approach").status).toBe(1);
    expect(runRow(repo)).toMatchObject({ status: "stopped", stop_code: "rejected" });
    expect(trail(repo)).toEqual(["work:fail"]);
  });

  it("send back: the lane runs again with the note, then waits again", () => {
    const repo = approvalFlow();
    repo.sf("run");
    expect(repo.sf("send-back", runRow(repo)?.id ?? "", "--note", "use tabs, not spaces").status).toBe(3);
    expect(trail(repo)).toEqual(["work:pass", "work:pass"]);
    expect(promptsOf(repo, "work")[1]).toContain("use tabs, not spaces");
    expect(repo.sf("approve", runRow(repo)?.id ?? "").status).toBe(0);
    expect(runRow(repo)?.status).toBe("done");
  });

  it("a command that needs approval has not run before it is given", () => {
    const flag = (home: string) => join(home, "shipped");
    const repo = flowRepo({
      lanes: [
        agentLane("build", { on: { pass: "ship", fail: "@stop" } }),
        commandLane("ship", 'touch "$SHIP_FLAG"', { checkpoint: "in" }),
      ],
    });
    const factory = repo.json<{ gateEnv?: string[] }>(".factor/factory.json");
    factory.gateEnv = ["SHIP_FLAG"];
    repo.write(".factor/factory.json", JSON.stringify(factory));
    repo.git("commit", "-qam", "let the command see the flag");
    repo.env.SHIP_FLAG = flag(repo.home);
    expect(repo.sf("run").status).toBe(3);
    expect(existsSync(flag(repo.home))).toBe(false);
    expect(repo.sf("approve", runRow(repo)?.id ?? "").status).toBe(0);
    expect(existsSync(flag(repo.home))).toBe(true);
    expect(trail(repo)).toEqual(["build:pass", "ship:pass"]);
  });

  it("answer: a lane that asked a question runs again with the answer", () => {
    const repo = flowRepo({
      lanes: [agentLane("work")],
      scripts: {
        author: { work: [[{ handoff: { outcome: "needsPerson", summary: "Which database?" } }], [pass()]] },
      },
    });
    expect(repo.sf("run").status).toBe(3);
    expect(repo.sf("inbox").stdout).toContain("Which database?");
    expect(repo.sf("answer", runRow(repo)?.id ?? "", "--note", "Postgres").status).toBe(0);
    expect(promptsOf(repo, "work")[1]).toContain("Postgres");
    expect(trail(repo)).toEqual(["work:needsPerson", "work:pass"]);
  });

  it("refuses a decision for a run that is not waiting", () => {
    const repo = flowRepo({ lanes: [agentLane("work")] });
    repo.sf("run");
    const r = repo.sf("approve", runRow(repo)?.id ?? "");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not waiting/);
  });
});
