// A waiting run belongs to the workflow it started with. When another workflow has become the one in use,
// a decision is refused in words that name both, not on what the other workflow needs.
import { describe, expect, it } from "vitest";
import { agentLane, commitFile, flowRepo, pass, runRow } from "../helpers/repo.ts";

describe("a decision on a run whose workflow is no longer the one in use", () => {
  it("is refused naming both workflows, and the run keeps waiting", () => {
    const repo = flowRepo({
      lanes: [agentLane("work", { agent: { access: "write" }, gates: ["verify"], checkpoint: "in" })],
      scripts: { author: { work: [[...commitFile("a.txt"), pass()]] } },
    });
    expect(repo.sf("run").status).toBe(3);
    const run = runRow(repo)?.id ?? "";
    // another workflow, with a lane for a role this machine does not have, becomes the one in use
    const own = JSON.parse(repo.read(".factor/workflows/starter.json"));
    const other = {
      ...own,
      name: "other",
      roles: { checker: { description: "Checks." } },
      lanes: [agentLane("review", { agent: { role: "checker" } })],
    };
    repo.write(".factor/workflows/other.json", `${JSON.stringify(other, null, 2)}\n`);
    const local = JSON.parse(repo.read(".factor/local.json"));
    repo.write(".factor/local.json", `${JSON.stringify({ ...local, workflow: "other" }, null, 2)}\n`);
    const cli = repo.sf("approve", run);
    expect(cli.status).toBe(1);
    expect(cli.stderr).toMatch(/starter/);
    expect(cli.stderr).toMatch(/other/);
    expect(cli.stderr).not.toMatch(/not bound/);
    expect(repo.rows("select status from inbox")).toEqual([{ status: "open" }]);
    expect(runRow(repo)?.status).toBe("waiting");
    // with its own workflow in use again, the same decision goes through
    repo.write(".factor/local.json", `${JSON.stringify(local, null, 2)}\n`);
    expect(repo.sf("approve", run).status).toBe(0);
  }, 120_000);
});
