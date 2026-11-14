// The order of the Runs list: what waits for a person, then what works, then what stopped, then what is done.
import { describe, expect, it } from "vitest";
import type { RunRow } from "../core/runs/view.ts";
import { inOrder } from "./run-order.ts";

const row = (id: string, status: RunRow["status"], stopCode: string | null, startedAt: string) =>
  ({ id, status, stopCode, startedAt }) as RunRow;

describe("the order of the list of runs", () => {
  const runs = [
    row("done-new", "done", "done", "2026-11-14T12:00:00Z"),
    row("work-new", "running", null, "2026-11-14T11:00:00Z"),
    row("stop-old", "stopped", "lane_failed", "2026-11-14T09:00:00Z"),
    row("asks-old", "waiting", "awaiting_approval", "2026-11-14T08:00:00Z"),
    row("asks-new", "waiting", "needs_person", "2026-11-14T10:00:00Z"),
    row("work-old", "running", null, "2026-11-14T07:00:00Z"),
    row("stop-new", "stopped", "stopped_by_person", "2026-11-14T10:30:00Z"),
    row("done-old", "done", "done", "2026-11-14T06:00:00Z"),
  ];

  it("puts waits for you first, then working, then stopped, then done, the newest first in each", () => {
    expect(inOrder(runs).map((r) => r.id)).toEqual([
      "asks-new",
      "asks-old",
      "work-new",
      "work-old",
      "stop-new",
      "stop-old",
      "done-new",
      "done-old",
    ]);
  });

  it("does not change the list it is given", () => {
    const before = runs.map((r) => r.id);
    inOrder(runs);
    expect(runs.map((r) => r.id)).toEqual(before);
  });
});
