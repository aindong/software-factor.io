import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseWorkflow } from "../../src/core/schema/parse.ts";

// biome-ignore lint/suspicious/noExplicitAny: the test breaks a valid workflow on purpose
type Loose = any;
type Change = (w: Loose) => void;
const base = (): Loose => JSON.parse(readFileSync("workflows/bugfix-fast.json", "utf8"));
const lane = (w: Loose, id: string) => w.lanes.find((l: Loose) => l.id === id);
const bounded = [{ to: "fix", maxRounds: 2 }, { to: "@stop" }];
const guarded = [{ to: "open-pr", when: { ref: "change.tier", in: ["ui"] } }, { to: "@stop" }];

// Each case breaks one rule. The problem must name the place (`where`) and say what to change (`fix`).
const rejects: [string, Change, RegExp, RegExp][] = [
  [
    "an unknown key at the top",
    (w) => {
      w.surprise = true;
    },
    /^\(top\)$/,
    /surprise/,
  ],
  [
    "an unknown key on a lane",
    (w) => {
      lane(w, "fix").surprise = 1;
    },
    /^lanes\[0\]$/,
    /surprise/,
  ],
  [
    "an unknown key in a transition entry",
    (w) => {
      lane(w, "fix").on.pass = [guarded[0], { to: "@stop", surprise: 1 }];
    },
    /^lanes\[0\]\.on\.pass\[1\]$/,
    /surprise/,
  ],
  [
    "an unknown key in a gate",
    (w) => {
      w.gates.verify.surprise = 1;
    },
    /^gates\.verify$/,
    /surprise/,
  ],
  [
    "an account named on a lane",
    (w) => {
      lane(w, "fix").agent.account = "claude-pf";
    },
    /^lanes\[0\]\.agent$/,
    /role/,
  ],
  [
    "an account named in the roles",
    (w) => {
      w.roles.author.account = "claude-pf";
    },
    /^roles\.author$/,
    /role/,
  ],
  [
    "lanes nested inside a lane",
    (w) => {
      lane(w, "fix").lanes = [structuredClone(lane(w, "open-pr"))];
    },
    /^lanes\[0\]$/,
    /lanes/,
  ],
  [
    "a fourth outcome",
    (w) => {
      lane(w, "fix").on.timeout = "open-pr";
    },
    /^lanes\[0\]\.on$/,
    /timeout/,
  ],
  [
    "a transition that points back with no round limit",
    (w) => {
      lane(w, "open-pr").on.fail = "fix";
    },
    /^lanes\[1\]\.on\.fail$/,
    /maxRounds/,
  ],
  [
    "a lane that points at itself with no round limit",
    (w) => {
      lane(w, "fix").on.fail = "fix";
    },
    /^lanes\[0\]\.on\.fail$/,
    /maxRounds/,
  ],
  [
    "a transition list whose last entry is not a plain default",
    (w) => {
      lane(w, "open-pr").on.fail = [bounded[0]];
    },
    /^lanes\[1\]\.on\.fail\[0\]$/,
    /final entry/,
  ],
  [
    "a transition to a lane that does not exist",
    (w) => {
      lane(w, "fix").on.pass = "nowhere";
    },
    /^lanes\[0\]\.on\.pass$/,
    /lane id/,
  ],
  [
    "a role that is not declared",
    (w) => {
      lane(w, "fix").agent.role = "ghost";
    },
    /^lanes\[0\]\.agent\.role$/,
    /ghost/,
  ],
  [
    "a gate that is not defined",
    (w) => {
      lane(w, "fix").gates.push("missing-gate");
    },
    /^lanes\[0\]\.gates$/,
    /missing-gate/,
  ],
  [
    "a command gate that names no command",
    (w) => {
      w.gates.verify.with = {};
    },
    /^gates\.verify/,
    /"run"|"command"/,
  ],
  [
    "a condition written as a string",
    (w) => {
      lane(w, "fix").on.pass = [{ to: "open-pr", when: "tier == 'ui'" }, { to: "@stop" }];
    },
    /^lanes\[0\]\.on\.pass\[0\]\.when$/,
    /"ref"/,
  ],
  [
    "a one-way lane a person does not approve",
    (w) => {
      lane(w, "open-pr").oneWay = true;
      lane(w, "open-pr").checkpoint = "near";
    },
    /^lanes\[1\]\.checkpoint$/,
    /"in"/,
  ],
  [
    "a lane that writes code with no gate",
    (w) => {
      lane(w, "fix").gates = [];
    },
    /^lanes\[0\]\.gates$/,
    /access/,
  ],
  [
    "a lane nothing leads to",
    (w) => {
      w.lanes.push({ ...structuredClone(lane(w, "open-pr")), id: "orphan" });
    },
    /^lanes\[2\]$/,
    /transition/,
  ],
  [
    "two lanes with one id",
    (w) => {
      w.lanes.push(structuredClone(lane(w, "open-pr")));
    },
    /^lanes\[2\]\.id$/,
    /id/,
  ],
  [
    "a file from a newer version",
    (w) => {
      w.version = 2;
    },
    /^version$/,
    /[Uu]pgrade/,
  ],
  [
    "a file with no version",
    (w) => {
      delete w.version;
    },
    /^version$/,
    /"version"/,
  ],
  [
    "a file with no $schema",
    (w) => {
      delete w.$schema;
    },
    /^\$schema$/,
    /"\$schema"/,
  ],
  [
    "an MCP server that is not declared",
    (w) => {
      lane(w, "fix").agent.mcp = ["ghost-server"];
    },
    /^lanes\[0\]\.agent\.mcp$/,
    /ghost-server/,
  ],
  [
    "a secret value in an MCP entry",
    (w) => {
      w.mcp = { gh: { from: "command", command: "npx", env: ["GITHUB_TOKEN=abc123"] } };
    },
    /^mcp\.gh\.env\[0\]$/,
    /name/,
  ],
  [
    "no way to finish",
    (w) => {
      lane(w, "open-pr").on.pass = "@stop";
    },
    /^lanes$/,
    /@done/,
  ],
];

// The valid form of each rule above must be accepted, so a rule cannot pass by rejecting everything.
const accepts: [string, Change][] = [
  [
    "a loop back with a round limit and a default",
    (w) => {
      lane(w, "open-pr").on.fail = bounded;
    },
  ],
  [
    "a lane that loops on itself with a round limit",
    (w) => {
      lane(w, "fix").on.fail = bounded;
    },
  ],
  [
    "a condition written as data",
    (w) => {
      lane(w, "fix").on.pass = guarded;
    },
  ],
  [
    "a one-way lane a person approves",
    (w) => {
      lane(w, "open-pr").oneWay = true;
    },
  ],
  [
    "an MCP entry that names an environment variable",
    (w) => {
      w.mcp = { gh: { from: "command", command: "npx", env: ["GITHUB_TOKEN"] } };
      lane(w, "fix").agent.mcp = ["gh"];
    },
  ],
  [
    "a lane that only reads, with no gate",
    (w) => {
      lane(w, "fix").agent.access = "read";
      lane(w, "fix").gates = [];
    },
  ],
  [
    "needsPerson written out",
    (w) => {
      lane(w, "fix").on.needsPerson = "@inbox";
    },
  ],
];

describe("rules the workflow file must keep", () => {
  it("accepts the unbroken workflow", () => {
    expect(parseWorkflow(base()).problems).toEqual([]);
  });

  it.each(accepts)("accepts %s", (_name, change) => {
    const w = base();
    change(w);
    expect(parseWorkflow(w).problems).toEqual([]);
  });

  it.each(rejects)("rejects %s", (_name, breakIt, where, fix) => {
    const w = base();
    breakIt(w);
    const { problems, workflow } = parseWorkflow(w);
    expect(workflow).toBeUndefined();
    const hit = problems.find((p) => where.test(p.path) && fix.test(p.fix));
    expect(hit, `problems were: ${JSON.stringify(problems, null, 1)}`).toBeDefined();
  });
});
