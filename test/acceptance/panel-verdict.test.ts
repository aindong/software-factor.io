import { describe, expect, it } from "vitest";
import { fail, flowRepo, panelLane, pass, trail } from "../helpers/repo.ts";

const verdict = (members: Record<string, unknown>[], scripts: Record<string, unknown>, joinBy = "all") => {
  const repo = flowRepo({ lanes: [panelLane(members, { join: joinBy })], scripts: { reviewer: scripts } });
  const run = repo.sf("run");
  return { repo, run, note: repo.rows<{ note: string }>("select note from lane_runs")[0]?.note ?? "" };
};
const two = [{ id: "logic" }, { id: "needs" }];

describe("the verdict of a panel that needs all", () => {
  it("is a pass when every deciding member passes", () => {
    const { repo, run, note } = verdict(two, { "*": [pass()] });
    expect(run.status).toBe(0);
    expect(trail(repo)).toEqual(["review:pass"]);
    expect(note).toMatch(/logic: pass/);
    expect(note).toMatch(/needs: pass/);
  });

  it("is a fail when one fails, and names the member and its reason", () => {
    const { repo, run, note } = verdict(two, {
      "review.logic": [pass()],
      "review.needs": [fail("criterion 2 is not met")],
    });
    expect(run.status).toBe(1);
    expect(trail(repo)).toEqual(["review:fail"]);
    expect(note).toMatch(/needs: fail.*criterion 2 is not met/);
  });

  it("is not changed by a member that only advises, whose verdict is still reported", () => {
    const members = [...two, { id: "style", advisory: true }];
    const { run, note } = verdict(members, { "*": [pass()], "review.style": [fail("too many helpers")] });
    expect(run.status).toBe(0);
    expect(note).toMatch(/style \(advises\): fail.*too many helpers/);
  });
});

describe("the verdict of a panel that needs any", () => {
  it("is a pass when one deciding member passes", () => {
    const { run } = verdict(two, { "review.logic": [fail("no")], "review.needs": [pass()] }, "any");
    expect(run.status).toBe(0);
  });

  it("is a fail when none does, also when an advising member passes", () => {
    const members = [...two, { id: "style", advisory: true }];
    const { run } = verdict(members, { "*": [fail("no")], "review.style": [pass()] }, "any");
    expect(run.status).toBe(1);
  });
});
