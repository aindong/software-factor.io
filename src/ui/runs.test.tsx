// The markup of a run that the keyboard, a screen reader and the browser check rely on.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { drawable, layout } from "../core/floor/layout.ts";
import { routeOf, trackOf } from "../core/runs/track.ts";
import type { RunRow } from "../core/runs/view.ts";
import type { Workflow } from "../core/schema/workflow.ts";
import { Diagram } from "./Diagram.tsx";
import { Strip } from "./Strip.tsx";
import { ago, cost, span, standing, tokens } from "./words.ts";

const workflow = drawable({
  lanes: [
    { id: "build", name: "Build", uses: "core/agent@1", on: { pass: "review", fail: "@stop" } },
    { id: "review", uses: "core/agent@1", on: { pass: "@done", fail: "build" } },
  ],
}) as Workflow;
const floor = layout(workflow);
const visits = [
  { lane: "build", outcome: "pass" as const },
  { lane: "review", outcome: "fail" as const },
  { lane: "build", outcome: null },
];
const nothing = () => {};

describe("a run as a strip map", () => {
  it("says in words what each stop shows in shape and colour", () => {
    const strip = renderToStaticMarkup(
      <Strip
        track={trackOf(["build", "review"], visits, undefined, "build")}
        nameOf={(id) => (id === "build" ? "Build" : id)}
      />,
    );
    expect(strip).toContain('aria-label="Build at work, the run is here; review failed"');
    expect(strip).toContain('role="img"');
    expect(strip.match(/class="stop /g)?.length).toBe(2);
    expect(strip).toContain('class="train"');
  });

  it("has no train for a run that is done", () => {
    const strip = renderToStaticMarkup(
      <Strip
        track={trackOf(["build"], [{ lane: "build", outcome: "pass" }], undefined, null)}
        nameOf={(id) => id}
      />,
    );
    expect(strip).not.toContain('class="train"');
    expect(strip).toContain('aria-label="build passed"');
  });
});

describe("a run over the map", () => {
  const track = trackOf(["build", "review"], visits, 2, "build");
  const map = renderToStaticMarkup(
    <Diagram
      floor={floor}
      onSelect={nothing}
      states={Object.fromEntries(track.lanes.map((l) => [l.id, l.state]))}
      route={routeOf(floor.lines, visits, 2)}
      trains={[{ lane: "review", label: "7", title: "A task. Review: the agent is working." }]}
    />,
  );

  it("names what the run did at each station, and where its train is", () => {
    expect(map).toContain('aria-label="Lane Build, no role, passed in this run"');
    expect(map).toContain('aria-label="Lane review, no role, failed in this run, task 7 is here"');
    expect(map).toContain("ran-pass");
    expect(map).toContain("ran-fail");
    expect(map).toContain("<title>A task. Review: the agent is working.</title>");
  });

  it("lights the lines the run took and no other", () => {
    expect(map.match(/class="line [^"]*lit"/g)?.length).toBe(1);
    expect(map).toContain("overlaid");
  });

  it("is read and not changed: no handle to drag, and it says so", () => {
    expect(map).not.toContain('class="handle');
    expect(map).toContain("The run on the workflow");
    const editable = renderToStaticMarkup(<Diagram floor={floor} onSelect={nothing} onConnect={nothing} />);
    expect(editable).toContain('class="handle');
    expect(editable).not.toContain("overlaid");
  });
});

describe("the words of a row", () => {
  const row = (status: RunRow["status"], stopCode: string | null) => ({ status, stopCode }) as RunRow;
  it.each([
    [row("running", null), "moving", "Moving"],
    [row("waiting", "awaiting_approval"), "asked", "Waits for you"],
    [row("waiting", "needs_person"), "asked", "Waits for you"],
    [row("waiting", "waiting"), "moving", "Waits by itself"],
    [row("waiting", "account_limit"), "moving", "Waits by itself"],
    [row("done", "done"), "pass", "Done"],
    [row("stopped", "lane_failed"), "fail", "Stopped"],
    [row("dropped", "dropped"), "none", "Dropped"],
  ])("%j", (run, mark, word) => {
    expect(standing(run)).toEqual({ mark, word });
  });

  it("writes amounts and times the same way everywhere", () => {
    expect(tokens(1200)).toBe("1,200 tokens");
    expect(tokens(1)).toBe("1 token");
    expect(cost(0.25, false)).toBe("$0.25");
    expect(cost(0.25, true)).toBe("at least $0.25");
    expect(cost(0, true)).toBe("cost not known");
    expect([span(900), span(45_000), span(185_000), span(7_800_000)]).toEqual([
      "1s",
      "45s",
      "3m 05s",
      "2h 10m",
    ]);
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(ago("2026-11-10T11:59:40Z", now)).toBe("just now");
    expect(ago("2026-11-10T11:55:00Z", now)).toBe("5 min ago");
    expect(ago("2026-11-10T09:00:00Z", now)).toBe("3 h ago");
    expect(ago("not a date", now)).toBe("");
  });
});
