// A run whose task was put back in the queue says so: the page's list reads the task's own state.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jsonOf, startUi, type Ui } from "../helpers/repo.ts";
import { threeRuns } from "../helpers/runs.ts";

const { repo, stopped } = threeRuns();
let ui: Ui;
afterAll(() => ui?.stop());
beforeAll(async () => {
  ui = await startUi(repo);
}, 120_000);
const row = async () =>
  (
    await jsonOf<{ runs: { id: string; taskStatus: string; sentence: string }[] }>(await ui.api("/api/runs"))
  ).runs.find((r) => r.id === stopped);

describe("a stopped run's row", () => {
  it("carries its task's state, and says the task is queued again once it is", async () => {
    expect((await row())?.taskStatus).toBe("stopped");
    expect((await row())?.sentence).not.toMatch(/queued again/);
    expect(repo.sf("requeue", stopped).status).toBe(0);
    expect((await row())?.taskStatus).toBe("queued");
    expect((await row())?.sentence).toMatch(/Its task is queued again: `softwarefactor run` starts it\.$/);
  });
});
