// The three workflows that ship run to the end as they are: each file is copied into a workspace
// unchanged, the roles are worked by the scripted agent, and the workspace says only what its
// own commands are. Nothing of the factory's source is changed for any of them.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { standIn } from "../helpers/collect.ts";
import { makeRepo, type Repo } from "../helpers/repo.ts";

type Json = Record<string, unknown>;
const TEST = (name: string, call: string, want: string) =>
  `import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { ${name} } from "./${name}.js";\n\ntest("${name}", () => {\n  assert.equal(${call}, ${want});\n});\n`;
const write = (path: string, content: string) => ({ write: { path, content } });
const pass = (outputs?: Json) => ({
  handoff: { outcome: "pass", summary: "Done.", ...(outputs ? { outputs } : {}) },
});
// a change with a test that fails without it
const change = [
  write("double.js", "export const double = (n) => n * 2;\n"),
  write("double.test.js", TEST("double", "double(4)", "8")),
  { commit: "Add double, with its test" },
];

/** A small project with a test, and the shipped workflow `name` in it, byte for byte. */
function workspace(name: string, commands: Json, roles: Record<string, Json>): Repo {
  const repo = makeRepo();
  repo.write(
    "package.json",
    `${JSON.stringify({ name: "shop", type: "module", scripts: { test: "node --test" } })}\n`,
  );
  repo.write("sum.js", "export const sum = (a, b) => a + b;\n");
  repo.write("sum.test.js", TEST("sum", "sum(2, 3)", "5"));
  expect(repo.sf("init").status).toBe(0);
  const shipped = readFileSync(`workflows/${name}.json`, "utf8");
  repo.write(`.factor/workflows/${name}.json`, shipped);
  repo.write(
    ".factor/factory.json",
    `${JSON.stringify({ version: 1, workflow: name, commands }, null, 2)}\n`,
  );
  repo.write(
    ".factor/local.json",
    `${JSON.stringify({ roles: Object.fromEntries(Object.entries(roles).map(([role, script]) => [role, { adapter: "fake", script }])) }, null, 2)}\n`,
  );
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "a factory");
  expect(repo.read(`.factor/workflows/${name}.json`)).toBe(shipped);
  return repo;
}
/** Run the next task, approving as it is wherever it waits. The run's last state. */
function toTheEnd(repo: Repo): { status: string; lanes: string[] } {
  let r = repo.sf("run");
  for (let i = 0; i < 4 && r.status === 3; i++) {
    const [run] = repo.rows<{ id: string }>("select id from runs");
    r = repo.sf("approve", run?.id ?? "");
  }
  const [run] = repo.rows<{ status: string }>("select status from runs");
  const lanes = repo
    .rows<{ lane: string; outcome: string }>("select lane, outcome from lane_runs order by id")
    .map((l) => `${l.lane}:${l.outcome}`);
  if (run?.status !== "done") throw new Error(`${r.stdout}${r.stderr}`);
  return { status: run.status, lanes };
}

it("alleo-loop runs to the end: plan, build, impact, a review panel, ship", () => {
  const plan = "docs/plans/double.md";
  const repo = workspace(
    "alleo-loop",
    { verify: "node --test", ship: "true" },
    {
      author: {
        plan: [
          write(
            plan,
            "# Plan\n\n## Acceptance criteria\n\n1. double(4) is 8.\n\n## Verification contract\n\n- 1: test:double.test.js\n",
          ),
          { commit: "The plan" },
          pass({ plan }),
        ],
        build: [...change, pass()],
        impact: [pass({ fact: "Nothing imports double yet.", proof: "run" })],
      },
      reviewer: { "*": [pass({ findings: [] })] },
    },
  );
  repo.write(".factor/tasks.md", "- [ ] Add a double function\n");
  // the owner's own plan check is a tool of their machine: here a stand-in that reads the same sections
  standIn(repo, "alleo-plan-check", 'grep -q "^## Acceptance criteria" "$1" && grep -q "^- 1: test:" "$1"');
  expect(toTheEnd(repo)).toEqual({
    status: "done",
    lanes: ["plan:pass", "build:pass", "impact:pass", "review:pass", "ship:pass"],
  });
  expect(repo.rows("select gate from gate_results where status <> 'pass'")).toEqual([]);
}, 120_000);

it("bugfix-fast runs to the end: an issue collected through gh, a fix with a test that fails without it, a pull request", () => {
  const repo = workspace(
    "bugfix-fast",
    { verify: "node --test", "open-pr": "true" },
    { author: { fix: [...change, pass({ cause: "Nothing doubled a number." })] } },
  );
  const issues = [
    {
      number: 7,
      title: "Doubling is missing",
      body: "There is no double.",
      labels: [{ name: "factory:bug" }],
      author: { login: "mona" },
      url: "https://example.com/7",
    },
  ];
  standIn(repo, "gh", `cat << 'JSON'\n${JSON.stringify(issues)}\nJSON`);
  expect(toTheEnd(repo)).toEqual({ status: "done", lanes: ["fix:pass", "open-pr:pass"] });
  expect(repo.rows("select collector, key from tasks")).toEqual([{ collector: "bugs", key: "#7" }]);
}, 120_000);

it("research-only runs to the end: a report with its sources, and a critic who finds nothing unsupported", () => {
  const report = "docs/reports/releases.md";
  const repo = workspace(
    "research-only",
    {},
    {
      researcher: {
        research: [
          write(
            report,
            "# Releases\n\nNothing broke this week.\n\n## Sources\n\n- https://example.com/changelog\n",
          ),
          { commit: "The report" },
          pass({ report }),
        ],
      },
      critic: { critique: [pass({ unsupported: [] })] },
    },
  );
  repo.write(".factor/questions.md", "- [ ] Which dependencies had a breaking release this week?\n");
  expect(toTheEnd(repo)).toEqual({ status: "done", lanes: ["research:pass", "critique:pass"] });
}, 120_000);
