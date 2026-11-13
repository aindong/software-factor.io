// A run that a person stopped did not fail: its badge and its lane on the map carry the neutral mark.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { drawable, layout } from "../core/floor/layout.ts";
import type { RunRow } from "../core/runs/view.ts";
import type { Workflow } from "../core/schema/workflow.ts";
import { Diagram } from "./Diagram.tsx";
import { standing } from "./words.ts";

const row = (stopCode: string) => ({ status: "stopped", stopCode }) as RunRow;

describe("a run that a person stopped", () => {
  it("is Stopped with the neutral mark; a run that stopped on a gate keeps the mark of a failure", () => {
    expect(standing(row("stopped_by_person"))).toEqual({ mark: "stopped", word: "Stopped" });
    expect(standing(row("gate_failed"))).toEqual({ mark: "fail", word: "Stopped" });
  });

  it("says so at its lane on the map, without the word or the cross of a failure", () => {
    const floor = layout(
      drawable({
        lanes: [{ id: "build", name: "Build", uses: "core/agent@1", on: { pass: "@done", fail: "@stop" } }],
      }) as Workflow,
    );
    const map = renderToStaticMarkup(
      <Diagram floor={floor} onSelect={() => {}} states={{ build: "stopped" }} />,
    );
    expect(map).toContain("Lane Build, no role, stopped by a person in this run");
    expect(map).toContain("ran-stopped");
    expect(map).not.toMatch(/failed in this run|ran-fail/);
  });
});
