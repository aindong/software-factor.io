// What can be checked of the interface without a browser: the status line's words, and the markup
// the diagram and the problem list give to a keyboard and a screen reader.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { drawable, layout } from "../core/floor/layout.ts";
import type { Workflow } from "../core/schema/workflow.ts";
import { Diagram } from "./Diagram.tsx";
import { Problems } from "./Inspector.tsx";
import { statusOf } from "./status.ts";

const workflow = drawable(JSON.parse(readFileSync("workflows/alleo-loop.json", "utf8"))) as Workflow;
const nothing = () => {};

describe("the status line", () => {
  const base = { broken: undefined, problems: 0, dirty: false, notice: undefined };
  it.each([
    [{ ...base }, "Saved", false],
    [{ ...base, dirty: true }, "Not saved", false],
    [{ ...base, problems: 1, dirty: true }, "1 problem", true],
    [{ ...base, problems: 3, dirty: true }, "3 problems", true],
    [{ ...base, broken: "Unexpected end", dirty: true }, "The JSON does not parse", true],
    [{ ...base, notice: { text: "Saved.", bad: false } }, "Saved.", false],
  ])("says the state it is in: %j", (state, words, bad) => {
    expect(statusOf(state)).toEqual({ text: words, bad });
  });

  it("shows why a save failed, though the workflow is still not saved", () => {
    const failed = {
      ...base,
      dirty: true,
      notice: { text: "Not saved: the name must match the file.", bad: true },
    };
    expect(statusOf(failed)).toEqual({ text: "Not saved: the name must match the file.", bad: true });
  });
});

describe("the diagram, for a keyboard", () => {
  const draw = (selected?: string) =>
    renderToStaticMarkup(
      <Diagram
        floor={layout(workflow)}
        selected={selected}
        flagged={new Set(["build"])}
        onSelect={nothing}
        onOpen={nothing}
        onAskConnect={nothing}
        onConnect={nothing}
      />,
    );

  it("has exactly one station in the tab order: the first, or the selected one", () => {
    expect(draw().match(/tabindex="0"/g)).toHaveLength(1);
    expect(draw()).toMatch(/tabindex="0"[^>]*aria-label="Lane Plan/);
    expect(draw("review").match(/tabindex="0"/g)).toHaveLength(1);
    expect(draw("review")).toMatch(/tabindex="0"[^>]*aria-pressed="true"[^>]*aria-label="Lane Review/);
  });

  it("names every station as a button, with what it is and what is wrong with it", () => {
    const stations = draw().match(/<g[^>]*class="station[^>]*>/g) ?? [];
    expect(stations.length).toBe(layout(workflow).stations.length);
    for (const station of stations) {
      expect(station).toMatch(/role="button"/);
      expect(station).toMatch(/aria-label="[^"]{4,}"/);
    }
    expect(draw()).toMatch(/aria-label="Lane Build, author, has problems"/);
    expect(draw()).toMatch(/aria-label="Lane Plan, author, waits for a person"/);
  });
});

describe("the problem list", () => {
  it("gives each problem's place, what is wrong and the fix", () => {
    const problems = [
      {
        path: "lanes[1].on.pass",
        message: "There is no lane called nowhere.",
        fix: "Name a lane, or an end such as @done.",
      },
      { path: "limits.minutes", message: "It must be a whole number.", fix: "Use a number such as 60." },
    ];
    const html = renderToStaticMarkup(
      <Problems
        problems={problems}
        laneAt={(path) => (path.startsWith("lanes[1]") ? "build" : undefined)}
        onSelect={nothing}
      />,
    );
    for (const p of problems) {
      expect(html).toContain(p.path);
      expect(html).toContain(p.message);
      expect(html).toContain(p.fix.replace("@", "@"));
    }
    expect(html).toContain("2 problems");
    expect(html.match(/<button/g)).toHaveLength(1); // only the problem that is about a lane leads to one
  });
});
