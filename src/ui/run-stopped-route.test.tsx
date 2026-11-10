// From the correctness review of task 15: the line to an end is lit only when the run came to it.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { drawable } from "../core/floor/layout.ts";
import type { RunRow } from "../core/runs/view.ts";
import type { Workflow } from "../core/schema/workflow.ts";

const workflow = drawable({
  lanes: [{ id: "build", uses: "core/agent@1", checkpoint: "in", on: { pass: "@done", fail: "@stop" } }],
}) as Workflow;
const row = (status: RunRow["status"], outcome: "pass" | "fail"): RunRow => ({
  id: "r1",
  taskId: 1,
  task: "A task",
  workflow: "starter",
  status,
  stopCode: status,
  reason: "",
  startedAt: "2026-11-10T10:00:00.000Z",
  endedAt: "2026-11-10T10:05:00.000Z",
  visits: [{ lane: "build", outcome }],
  stops: [{ id: "build", name: "build" }],
  own: false,
  at: status === "done" ? null : "build",
  sentence: "",
  tokens: 0,
  usd: 0,
  usdUnknown: false,
});
async function lit(given: RunRow): Promise<string[]> {
  // api.ts reads the page's address when it is loaded
  vi.stubGlobal("location", { hash: "", pathname: "/", reload: () => {} });
  vi.stubGlobal("addEventListener", () => {});
  const { RunView } = await import("./RunDetail.tsx");
  const page = renderToStaticMarkup(
    <RunView row={given} workflow={workflow} headRef={{ current: null }} onBack={() => {}} />,
  );
  return page.match(/class="line [^"]*lit"/g) ?? [];
}

it("does not draw a run that a person stopped at its approval as having reached Done", async () => {
  expect(await lit(row("stopped", "pass"))).toEqual([]);
});

it("draws a run that is done as having reached Done, and one that failed as stopped", async () => {
  expect(await lit(row("done", "pass"))).toEqual(['class="line pass lit"']);
  expect(await lit(row("stopped", "fail"))).toEqual(['class="line fail to-end lit"']);
  expect(await lit(row("waiting", "pass"))).toEqual([]);
});
