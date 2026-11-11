// The filter of the Runs list: which runs it shows, its counts, the address that keeps it, and its markup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RunRow } from "../core/runs/view.ts";
import { choices, emptyWords, kept, readShow, shownRuns, withShow } from "./filter.ts";
import { RunFilter } from "./RunFilter.tsx";
import { State } from "./State.tsx";
import { detail } from "./words.ts";

const row = (id: string, status: RunRow["status"], stopCode: string | null = null, sentence = "") =>
  ({ id, status, stopCode, sentence }) as RunRow;
const runs: [RunRow, RunRow, RunRow, RunRow, RunRow] = [
  row("a", "running"),
  row("b", "waiting", "awaiting_approval"),
  row("c", "done", "done", "Done."),
  row("d", "running"),
  row("e", "stopped", "lane_failed", "Stopped: a lane failed"),
];

describe("what the filter shows", () => {
  it("shows every run with no filter, and the runs of one state with one", () => {
    expect(shownRuns(runs, undefined).map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(shownRuns(runs, "working").map((r) => r.id)).toEqual(["a", "d"]);
    expect(shownRuns(runs, "waits-for-you").map((r) => r.id)).toEqual(["b"]);
    expect(shownRuns(runs, "dropped")).toEqual([]);
  });

  it("offers All and the states that have a run, in a fixed order, each with its count", () => {
    expect(choices(runs, undefined)).toEqual([
      { show: undefined, word: "All", n: 5 },
      { show: "working", word: "Working", n: 2 },
      { show: "waits-for-you", word: "Waits for you", n: 1 },
      { show: "done", word: "Done", n: 1 },
      { show: "stopped", word: "Stopped", n: 1 },
    ]);
  });

  it("keeps the chosen state on offer when its last run is gone", () => {
    expect(choices(runs, "dropped").map((c) => `${c.word} ${c.n}`)).toContain("Dropped 0");
  });

  it("says plainly that nothing is left", () => {
    expect(emptyWords("working")).toBe("No run is working.");
    expect(emptyWords("waits-for-you")).toBe("No run waits for you.");
    expect(emptyWords("waits-by-itself")).toBe("No run waits by itself.");
    expect(emptyWords("stopped")).toBe("No run is stopped.");
  });
});

describe("the filter in the address", () => {
  it("reads a state it knows and nothing else", () => {
    expect(readShow("?show=working")).toBe("working");
    expect(readShow("?x=1&show=done")).toBe("done");
    expect(readShow("?show=all")).toBeUndefined();
    expect(readShow("?show=nonsense")).toBeUndefined();
    expect(readShow("")).toBeUndefined();
  });

  it("writes it after a path, and nothing for All", () => {
    expect(withShow("/runs", "working")).toBe("/runs?show=working");
    expect(withShow("/runs/ab%20c", "stopped")).toBe("/runs/ab%20c?show=stopped");
    expect(withShow("/runs", undefined)).toBe("/runs");
  });

  it("knows whether a run is among those the filter shows", () => {
    expect(kept(runs[0], "working")).toBe(true);
    expect(kept(runs[2], "working")).toBe(false);
    expect(kept(runs[2], undefined)).toBe(true);
  });
});

describe("the filter's markup", () => {
  const draw = (show?: string) =>
    renderToStaticMarkup(<RunFilter runs={runs} show={show} onShow={() => {}} />);
  it("is a group of buttons, and says which one is chosen", () => {
    const all = draw();
    expect(all).toContain("<fieldset");
    expect(all).toContain('<legend class="sr">Show</legend>');
    expect(all).toMatch(/aria-pressed="true"[^>]*>All/);
    expect(all.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(all.match(/<button/g)?.length).toBe(5);
    const working = draw("working");
    expect(working).toMatch(/aria-pressed="true"[^>]*>Working/);
    expect(working).toMatch(/aria-pressed="false"[^>]*>All/);
    expect(working).toContain(">2<");
  });
});

describe("a row's state", () => {
  it("is a mark and its word, the same for a row and a page head", () => {
    expect(renderToStaticMarkup(<State run={runs[0]} />)).toBe(
      '<span class="state"><span class="mark working" aria-hidden="true"></span><b>Working</b></span>',
    );
    expect(renderToStaticMarkup(<State run={runs[4]} />)).toContain("<b>Stopped</b>");
  });

  it("is not said twice: a sentence that is only the state is left out", () => {
    expect(detail(runs[2])).toBe("");
    expect(detail(row("x", "dropped", "dropped", "Dropped."))).toBe("");
    expect(detail(runs[4])).toBe("Stopped: a lane failed");
    expect(detail(row("y", "running", null, "Review: the agent is working."))).toBe(
      "Review: the agent is working.",
    );
  });
});
