import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseWorkflow } from "../../src/core/schema/parse.ts";

// biome-ignore lint/suspicious/noExplicitAny: the test breaks a valid workflow on purpose
type Loose = any;
const base = (): Loose => JSON.parse(readFileSync("workflows/bugfix-fast.json", "utf8"));
const lane = (w: Loose, id: string) => w.lanes.find((l: Loose) => l.id === id);

// Each case breaks one rule. `says` must appear in the problem that names the place and the fix.
const cases: [string, (w: Loose) => void, RegExp][] = [
  ["an unknown key at the top", (w) => { w.surprise = true; }, /surprise/],
  ["an account named on a lane", (w) => { lane(w, "fix").agent.account = "claude-pf"; }, /account/],
  ["a transition that points back with no round limit", (w) => { lane(w, "open-pr").on.fail = "fix"; }, /maxRounds/],
  [
    "a transition list whose last entry is not a plain default",
    (w) => { lane(w, "open-pr").on.fail = [{ to: "fix", maxRounds: 2 }]; },
    /last entry/,
  ],
  ["a transition to a lane that does not exist", (w) => { lane(w, "fix").on.pass = "nowhere"; }, /nowhere/],
  ["a role that is not declared", (w) => { lane(w, "fix").agent.role = "ghost"; }, /ghost/],
  ["a gate that is not defined", (w) => { lane(w, "fix").gates.push("missing-gate"); }, /missing-gate/],
  ["a condition written as a string", (w) => { lane(w, "fix").on.pass = [{ to: "open-pr", when: "tier == 'ui'" }, { to: "@stop" }]; }, /when/],
  ["a one-way lane a person does not approve", (w) => { lane(w, "open-pr").oneWay = true; lane(w, "open-pr").checkpoint = "near"; }, /one-way|oneWay/],
  ["a lane that writes code with no gate", (w) => { lane(w, "fix").gates = []; }, /gate/],
  ["a lane nothing leads to", (w) => { w.lanes.push({ ...structuredClone(lane(w, "open-pr")), id: "orphan" }); }, /orphan/],
  ["two lanes with one id", (w) => { w.lanes.push(structuredClone(lane(w, "open-pr"))); }, /open-pr/],
  ["a file from a newer version", (w) => { w.version = 2; }, /version/],
  ["an MCP server that is not declared", (w) => { lane(w, "fix").agent.mcp = ["ghost-server"]; }, /ghost-server/],
  ["a secret value in an MCP entry", (w) => { w.mcp = { gh: { from: "command", command: "npx", env: ["GITHUB_TOKEN=abc123"] } }; }, /env/],
  ["no way to finish", (w) => { for (const l of w.lanes) { l.on.pass = l.on.pass === "@done" ? "@stop" : l.on.pass; } }, /@done/],
];

describe("rules the workflow file must keep", () => {
  it("accepts the unbroken workflow", () => {
    expect(parseWorkflow(base()).problems).toEqual([]);
  });

  it.each(cases)("rejects %s", (_name, breakIt, says) => {
    const w = base();
    breakIt(w);
    const { problems, workflow } = parseWorkflow(w);
    expect(workflow).toBeUndefined();
    const hit = problems.find((p) => says.test(`${p.path} ${p.message} ${p.fix}`));
    expect(hit, `problems were: ${JSON.stringify(problems, null, 1)}`).toBeDefined();
    expect(hit?.path.length).toBeGreaterThan(0);
    expect(hit?.fix.length).toBeGreaterThan(10);
  });
});
