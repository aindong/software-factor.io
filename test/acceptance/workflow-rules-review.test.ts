import { expect, it } from "vitest";
import { parseWorkflow } from "../../src/core/schema/parse.ts";
import { base, describeAccepts, describeRejects, lane, type Reject } from "./rules-helpers.ts";

// Found by the correctness review of the first schema.
const rejects: Reject[] = [
  [
    "a gate named like a built-in object property",
    (w) => {
      lane(w, "fix").gates = ["constructor"];
    },
    /^lanes\[0\]\.gates$/,
    /constructor/,
  ],
  [
    "a role named like a built-in object property",
    (w) => {
      lane(w, "fix").agent.role = "constructor";
    },
    /^lanes\[0\]\.agent\.role$/,
    /constructor/,
  ],
  [
    "a value on a lane called task that does not exist",
    (w) => {
      lane(w, "fix").on.pass = [
        { to: "open-pr", when: { ref: "task.outputs.nope", in: ["x"] } },
        { to: "@stop" },
      ];
    },
    /^lanes\[0\]\.on\.pass\[0\]\.when\.ref$/,
    /lane/,
  ],
  [
    "a secret in a URL parameter whose name ends in secret",
    (w) => {
      w.mcp = { d: { from: "url", url: "https://example.com/mcp?client_id=a&client_secret=abcdef123456" } };
    },
    /^mcp\.d\.url$/,
    /environment variable/,
  ],
  [
    "a password in a URL's user part",
    (w) => {
      w.mcp = { d: { from: "url", url: "https://bot:hunter2secret@example.com/mcp" } };
    },
    /^mcp\.d\.url$/,
    /environment variable/,
  ],
  [
    "an armoured private key block",
    (w) => {
      lane(w, "fix").meta = { note: "-----BEGIN PGP PRIVATE KEY BLOCK-----" };
    },
    /^lanes\[0\]\.meta\.note$/,
    /environment variable/,
  ],
  [
    "two inputs that differ only by capitals",
    (w) => {
      lane(w, "open-pr").inputs = { planA: "fix.outputs.cause", plana: "fix.outputs.cause" };
    },
    /^lanes\[1\]\.inputs$/,
    /FACTOR_INPUT_/,
  ],
  [
    "a gate id with capitals and an underscore",
    (w) => {
      w.gates.Verify_All = { uses: "core/protected-paths@1", onFail: "stop" };
    },
    /^gates\.Verify_All$/,
    /dashes/,
  ],
  [
    "an undeclared command inside a wait",
    (w) => {
      lane(w, "open-pr").on.pass = "wait-review";
      w.lanes.push({
        id: "wait-review",
        uses: "core/wait@1",
        with: { until: { command: "pr-reviewed" }, everyMinutes: 10, timeoutHours: 72 },
        checkpoint: "out",
        on: { pass: "@done", fail: "@stop" },
      });
    },
    /^lanes\[2\]\.with\.until\.command$/,
    /"commands"/,
  ],
];

describeRejects("rules found in review", rejects);

describeAccepts("values that only look like secrets", [
  [
    "an MCP header named api-key that names an environment variable",
    (w) => {
      w.mcp = {
        az: { from: "url", url: "https://example.com/mcp", headersEnv: { "api-key": "AZURE_API_KEY" } },
      };
    },
  ],
  [
    "a lane input called token",
    (w) => {
      lane(w, "fix").outputs.token = { type: "string" };
      lane(w, "open-pr").inputs = { token: "fix.outputs.token" };
    },
  ],
  [
    "a long identifier that starts with pk_",
    (w) => {
      lane(w, "fix").agent.prompt = "Add the index pk_orders_customer_2024_idx to the table.";
    },
  ],
  [
    "a URL that takes its token from an environment variable",
    (w) => {
      lane(w, "open-pr").with = { run: "curl -sf https://api.example.com/health?token=$HEALTH_TOKEN" };
    },
  ],
]);

it("reports every problem, even two that share a place and a fix", () => {
  const w = base();
  w.roles.author.differentVendorFrom = ["ghost-a", "ghost-b"];
  const messages = parseWorkflow(w).problems.map((p) => p.message);
  expect(messages.filter((m) => m.includes("ghost-a"))).toHaveLength(1);
  expect(messages.filter((m) => m.includes("ghost-b"))).toHaveLength(1);
});

it("does not crash on a deeply nested free-form value", () => {
  const w = base();
  let deep: Record<string, unknown> = {};
  for (let i = 0; i < 100_000; i++) deep = { a: deep };
  w.meta = deep;
  expect(() => parseWorkflow(w)).not.toThrow();
});
