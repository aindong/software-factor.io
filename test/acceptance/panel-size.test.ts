import { describe, expect, it } from "vitest";
import { agentLane, commitFile, flowRepo, panelLane, pass, sessionRows } from "../helpers/repo.ts";

const reviewed = (path: string) => {
  const repo = flowRepo({
    lanes: [
      agentLane("build", {
        agent: { access: "write" },
        gates: ["verify"],
        on: { pass: "review", fail: "@stop" },
      }),
      panelLane([
        { id: "logic" },
        { id: "security", when: { ref: "change.tier", in: ["sensitive", "api"] } },
        { id: "docs", when: { ref: "change.tier", in: ["docs"] }, advisory: true },
      ]),
    ],
    scripts: { author: { build: [...commitFile(path), pass()] } },
  });
  const run = repo.sf("run");
  if (run.status !== 0) throw new Error(run.stdout + run.stderr);
  return sessionRows(repo, "lane")
    .map((s) => String(s.lane))
    .filter((lane) => lane.startsWith("review."))
    .sort();
};

describe("a review sized to the change", () => {
  it("leaves the security member out of a change to documents", () => {
    expect(reviewed("docs/guide.md")).toEqual(["review.docs", "review.logic"]);
  });

  it("brings the security member in for a change to a sensitive file", () => {
    expect(reviewed("src/auth/login.ts")).toEqual(["review.logic", "review.security"]);
  });

  it("is the smallest panel for a plain change", () => {
    expect(reviewed("src/util/format.ts")).toEqual(["review.logic"]);
  });
});
