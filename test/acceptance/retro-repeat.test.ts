// What happens three times is worth a retro: the same gate failing at a lane, the same lane sent back.
import { expect, it } from "vitest";
import { ladderRepo, lastRun } from "../helpers/ladder.ts";
import { agentLane, commitFile, flowRepo, pass } from "../helpers/repo.ts";

it("lists one retro for a gate that failed at the same lane three times, and none for two", () => {
  const repo = flowRepo({
    lanes: [agentLane("build", { agent: { access: "write" }, gates: ["verify"] })],
    scripts: { author: { build: [...commitFile("notes.txt"), pass()] } },
    commands: { verify: "false" },
    tasks: "- [ ] One\n- [ ] Two\n- [ ] Three\n",
  });
  repo.sf("run");
  repo.sf("run");
  expect(repo.sf("retro").stdout).toMatch(/Nothing calls for a retro/);
  repo.sf("run");
  const runs = repo.rows<{ id: string }>("select id from runs order by started_at, rowid").map((r) => r.id);
  const out = repo.sf("retro").stdout;
  expect(out).toMatch(/^1\s+open\s+repeat\s+lane build: the gate verify failed in 3 of the last 20 runs/m);
  for (const id of runs) expect(out).toContain(id);
  expect(out.match(/^\d+\s+open/gm)).toHaveLength(1);
});

it("lists one retro for a lane whose work was sent back three times, with what was said", () => {
  const repo = ladderRepo();
  for (const note of ["Say more about the export", "The tests are missing", "Say more about the export"]) {
    repo.sf("run");
    repo.sf("send-back", lastRun(repo).id, "--note", note);
    for (let i = 0; i < 4 && lastRun(repo).status === "waiting"; i += 1) repo.sf("approve", lastRun(repo).id);
  }
  const out = repo.sf("retro").stdout;
  expect(out).toMatch(
    /^1\s+open\s+repeat\s+lane build: its work was sent back or rejected in 3 of the last 20 runs/m,
  );
  expect(out.match(/^\d+\s+open/gm)).toHaveLength(1);
});
