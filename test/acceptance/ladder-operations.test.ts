// The ladder is two operations: the interface, the command line and the operator's MCP server share them.
import { expect, it } from "vitest";
import { OPERATIONS } from "../../src/core/operations.ts";
import { checkpointOf, cleanRun, ladderRepo } from "../helpers/ladder.ts";
import { op, tool } from "../helpers/operator.ts";
import { startUi } from "../helpers/repo.ts";

interface Lane {
  lane: string;
  checkpoint: string;
  streak: number;
  needed: number;
  suggestion: string | null;
  why: string | null;
  last: { kind: string; from: string; to: string; at: string; note: string; run: string | null } | null;
}

it("lists the ladder and accepts a suggestion through the API, as the command does", async () => {
  expect(OPERATIONS.find((o) => o.name === "ladder_list")?.cli).toEqual([["ladder"]]);
  expect(OPERATIONS.find((o) => o.name === "ladder_accept")).toMatchObject({
    changes: true,
    cli: [["ladder", "accept"]],
  });
  const repo = ladderRepo();
  cleanRun(repo);
  cleanRun(repo);
  const ui = await startUi(repo);
  try {
    const before = await op<{ lanes: Lane[] }>(ui, "ladder_list");
    expect(before.body.lanes.find((l) => l.lane === "build")).toMatchObject({
      checkpoint: "in",
      streak: 2,
      needed: 2,
      suggestion: "near",
      last: null,
    });
    // the operator's own agent sees the same
    expect(tool<{ lanes: Lane[] }>(repo, "ladder_list").data.lanes).toEqual(before.body.lanes);
    const refused = await op(ui, "ladder_accept", { lane: "ship" });
    expect(refused.status).toBe(409);
    const moved = await op<{ lane: string; to: string }>(ui, "ladder_accept", { lane: "build" });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ lane: "build", to: "near" });
    expect(checkpointOf(repo)).toBe("near");
    const after = await op<{ lanes: Lane[] }>(ui, "ladder_list");
    expect(after.body.lanes.find((l) => l.lane === "build")).toMatchObject({
      checkpoint: "near",
      streak: 0,
      suggestion: null,
      last: { kind: "promoted", from: "in", to: "near", note: "2 runs in a row approved as they were" },
    });
  } finally {
    await ui.stop();
  }
});
