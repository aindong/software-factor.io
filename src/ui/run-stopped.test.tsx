// What a lane's card says: a lane a person stopped is "stopped", not "failed"; and every row of its
// evidence that is a gate's record carries the mark of how that gate went.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RunDetail } from "./api.ts";
import { STATE_WORD } from "./Strip.tsx";

vi.stubGlobal("location", { hash: "", pathname: "/", reload: () => {} });
vi.stubGlobal("addEventListener", () => {});
const { LaneVisit, stateOf } = await import("./LaneVisit.tsx");

type Lane = RunDetail["lanes"][number];
const lane = (over: Partial<Lane>): Lane => ({
  id: 1,
  lane: "plan",
  outcome: "fail",
  note: null,
  tokens: 0,
  usd: 0,
  durationMs: 0,
  startedAt: "",
  endedAt: "",
  gates: [],
  claims: [],
  sessions: [],
  output: null,
  handoff: null,
  ...over,
});
const proof = () => ({ open: true, onToggle: () => {}, at: () => {} });
const card = (l: Lane, files: RunDetail["files"] = []) =>
  renderToStaticMarkup(
    <LaneVisit lane={l} name="Plan" runId="r" files={files} proof={proof} show={() => {}} />,
  );

describe("a lane that a person stopped", () => {
  it("is Stopped with the neutral mark, and the page does not say failed", () => {
    const html = card(lane({ stopped: true, note: "stopped by a person" }));
    expect(html).toContain("Stopped");
    expect(html).toContain('class="mark stopped"');
    expect(html).not.toMatch(/failed|mark fail/);
    expect(STATE_WORD[stateOf("fail", true)]).toBe("stopped");
  });
  it("is still failed when it failed", () => {
    expect(card(lane({}))).toContain("failed");
  });
});

describe("a gate's record on the base commit", () => {
  it("has the mark of the gate it belongs to", () => {
    const gate = { gate: "floor", status: "fail", command: "", exitCode: 1, durationMs: 1, attempt: 1, output: "gates/floor.log" };
    const html = card(lane({ gates: [gate] }), [{ path: "gates/floor.base.log" } as RunDetail["files"][number]]);
    const at = html.indexOf("on the base commit");
    const row = html.slice(html.lastIndexOf("<button", at), at);
    expect(row).toContain("mark fail");
  });
});
