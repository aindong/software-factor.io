// An item of the inbox list carries the lane's own one-line summary when it has one, so that two
// waiting items can be told apart.
import { expect, it } from "vitest";
import { tool } from "../helpers/operator.ts";
import { agentLane, commandLane, commitFile, flowRepo, pass } from "../helpers/repo.ts";

const items = (repo: Parameters<typeof tool>[0]) =>
  tool<{ items: { summary: string }[] }>(repo, "inbox_list").data.items;

it("carries the summary of finished work", () => {
  const repo = flowRepo({
    lanes: [agentLane("work", { name: "Work", agent: { access: "write" }, checkpoint: "in" })],
    scripts: { author: { work: [[...commitFile("a.txt"), pass({ summary: "Added the search box." })]] } },
  });
  if (repo.sf("run").status !== 3) throw new Error("the run should wait");
  expect(items(repo)[0]?.summary).toBe("Added the search box.");
});

it("carries an empty one for a lane that has not run", () => {
  const repo = flowRepo({ lanes: [commandLane("ship", "true", { checkpoint: "in" })] });
  if (repo.sf("run").status !== 3) throw new Error("the run should wait");
  expect(items(repo)[0]?.summary).toBe("");
});
