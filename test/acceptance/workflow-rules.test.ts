import { expect, it } from "vitest";
import { parseWorkflow } from "../../src/core/schema/parse.ts";
import {
  base,
  bounded,
  type Change,
  describeAccepts,
  describeRejects,
  guarded,
  lane,
  type Reject,
} from "./rules-helpers.ts";

it("accepts the unbroken workflow", () => {
  expect(parseWorkflow(base()).problems).toEqual([]);
});

// Each case breaks one rule. The problem must name the place and say what to change.
const rejects: Reject[] = [
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
      lane(w, "open-pr").on.needsPerson = "@stop";
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

  [
    "a task dropped as not work",
    (w) => {
      lane(w, "fix").on.fail = "@drop";
    },
  ],
  [
    "a lane that waits for an outside event",
    (w) => {
      w.lanes.push({
        id: "wait-review",
        uses: "core/wait@1",
        with: { until: { command: "pr-reviewed" }, everyMinutes: 10, timeoutHours: 72 },
        checkpoint: "out",
        on: { pass: "@done", fail: bounded },
      });
      lane(w, "open-pr").on.pass = "wait-review";
      w.commands["pr-reviewed"] = { description: "Exits 0 once the pull request has a review." };
    },
  ],
  [
    "a checkpoint the ladder may not move",
    (w) => {
      lane(w, "open-pr").pin = true;
    },
  ],
  [
    "a role that prefers another vendor",
    (w) => {
      w.roles.reviewer = { description: "Reads the change.", differentVendorFrom: ["author"] };
    },
  ],
  [
    "a panel that only reads",
    (w) => {
      lane(w, "fix").agent.access = "read";
      lane(w, "fix").gates = [];
      lane(w, "fix").panel = { join: "all", members: [{ id: "a" }, { id: "b", advisory: true }] };
    },
  ],

  [
    "a command named like a package script",
    (w) => {
      w.gates.verify.with.command = "test:e2e";
      w.commands["test:e2e"] = { description: "Runs the browser tests." };
    },
  ],
  [
    "a lane that reads its own last round's output",
    (w) => {
      lane(w, "fix").inputs = { last: "fix.outputs.cause" };
    },
  ],
  [
    "a pinned lane that does not wait for a person",
    (w) => {
      lane(w, "fix").pin = true;
    },
  ],
  [
    "a prompt that mentions a risk-assessment-and-mitigation-plan",
    (w) => {
      lane(w, "fix").agent.prompt = "Follow the risk-assessment-and-mitigation-plan template.";
    },
  ],
  [
    "a long dashed file name",
    (w) => {
      w.collectors[0] = {
        id: "bugs",
        uses: "core/file@1",
        with: { path: ".factor/task-list-for-the-nightly-run.md" },
      };
    },
  ],
];

describeRejects("rules the workflow file must keep", rejects);
describeAccepts("the valid form of each rule", accepts);
