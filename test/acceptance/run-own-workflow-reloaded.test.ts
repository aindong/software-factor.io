// A run keeps the workflow the process runs it on, not whatever the file holds when the run
// starts: one call can start several runs, and the file can be saved in between.
import { join } from "node:path";
import { expect, it } from "vitest";
import { commandLane, flowRepo } from "../helpers/repo.ts";

it("a run that starts after the workflow's file changed, in the same call, keeps the workflow it runs on", () => {
  const repo = flowRepo({
    tasks: "- [ ] First task\n- [ ] Second task\n",
    // the first run changes the workflow's file while the call is still going, as a save elsewhere would
    lanes: [commandLane("touch", 'printf "\\n" >> "$WF"')],
    factory: { gateEnv: ["WF"] },
  });
  const path = ".factor/workflows/starter.json";
  repo.env.WF = join(repo.dir, path);
  const loaded = repo.read(path);
  const call = repo.sf("run", "--all", "--parallel", "1");
  const runs = repo.rows<{ id: string; status: string }>(
    "select id, status from runs order by started_at, rowid",
  );
  expect(
    runs.map((r) => r.status),
    call.stdout + call.stderr,
  ).toEqual(["done", "done"]);
  expect(repo.read(path)).not.toBe(loaded); // the file did change between the two starts
  expect(repo.read(`.factor/runs/${runs[0]?.id}/workflow.json`), "first run").toBe(loaded);
  // the second run began after the change, but the process still runs the workflow it loaded
  expect(repo.read(`.factor/runs/${runs[1]?.id}/workflow.json`), "second run").toBe(loaded);
});
