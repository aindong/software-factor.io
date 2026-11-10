// From the skeptic's look at task 15: the last line of an agent's output is often very long (a
// tool's result after reading a large file). The sentence must come from the line before it.
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { agentLane, background, flowRepo, jsonOf, pass, startUi } from "../helpers/repo.ts";

type Row = { id: string; sentence: string };
const repo = flowRepo({
  lanes: [agentLane("build", { name: "Build" })],
  scripts: { author: { build: [{ sleep: 6000 }, pass()] } },
});
const line = (type: string, part: object) => JSON.stringify({ type, message: { content: [part] } });

it("uses an earlier line when the last one is megabytes long", async () => {
  const ui = await startUi(repo);
  const first = async () => (await jsonOf<{ runs: Row[] }>(await ui.api("/api/runs"))).runs[0];
  const run = background(repo, "run");
  let row = await first();
  for (let i = 0; i < 50 && row?.sentence !== "Build: the agent is working."; i++) {
    await new Promise((r) => setTimeout(r, 100));
    row = await first();
  }
  const work = join(repo.home, "work");
  const out = join(work, readdirSync(work)[0] ?? "", `${row?.id}.out`, "01-build.host");
  const did = line("assistant", { type: "tool_use", name: "Bash", input: { command: "npm test" } });
  const result = line("user", { type: "tool_result", content: "y".repeat(2_000_000) });
  writeFileSync(join(out, "stream.jsonl"), `${did}\n${result}\n`);
  const said = (await first())?.sentence;
  await run.exit;
  await ui.stop();
  expect(said).toBe("Build: the agent is running `npm test`.");
}, 120_000);
