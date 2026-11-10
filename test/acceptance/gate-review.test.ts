import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLane, evidenceOf, flowRepo, pass, type Repo, RUNNER } from "../helpers/repo.ts";

// Found by the correctness review of the gates.
const write = (path: string, content: string, extra: Record<string, unknown> = {}) => ({
  write: { path, content, ...extra },
});
const commit = { commit: "change" };
const one = (
  gate: Record<string, unknown>,
  o: {
    steps: unknown[];
    files?: Record<string, string>;
    verify?: string;
    setup?: string;
    factory?: Record<string, unknown>;
  },
) =>
  flowRepo({
    commands: { verify: o.verify ?? "sh run-tests.sh", ...(o.setup ? { setup: o.setup } : {}) },
    gates: { g: { onFail: "fail", ...gate } },
    lanes: [agentLane("build", { agent: { access: "write" }, gates: ["g"] })],
    scripts: { author: { build: [...o.steps, commit, pass()] } },
    files: o.files,
    factory: o.factory,
  });
const status = (repo: Repo) =>
  repo.rows<{ status: string }>("select status from gate_results").map((g) => g.status);

describe("protected paths", () => {
  const gate = { uses: "core/protected-paths@1" };
  it("sees a path with letters outside ASCII", () => {
    const repo = one(gate, { steps: [write(".github/workflows/déploy.yml", "x\n")] });
    repo.sf("run");
    expect(status(repo)).toEqual(["fail"]);
    expect(evidenceOf(repo)[0]).toContain("déploy.yml");
  });

  it("is not fooled by capital letters, which the file system ignores", () => {
    const repo = one(gate, { steps: [write(".Claude/settings.json", "{}\n")] });
    repo.sf("run");
    expect(status(repo)).toEqual(["fail"]);
  });

  it("names every protected file a change touches, deletions included", () => {
    const repo = one(gate, {
      steps: [write(".github/a.yml", "x\n"), write("docs/go.sum", "x\n"), { delete: ".factor/tasks.md" }],
    });
    repo.sf("run");
    const evidence = evidenceOf(repo)[0] ?? "";
    for (const f of [".github/a.yml", "docs/go.sum", ".factor/tasks.md"]) expect(evidence).toContain(f);
  });
});

describe("tests not weakened", () => {
  const TEST = `import { expect, it } from "vitest";
it("adds", () => {
  expect(1 + 1).toBe(2);
});
it("subtracts", () => {
  expect(2 - 1).toBe(1);
});
`;
  // the same two tests, moved inside a describe block: every line is indented, nothing else changed
  const WRAPPED = `import { describe, expect, it } from "vitest";
describe("math", () => {
  it("adds", () => {
    expect(1 + 1).toBe(2);
  });
  it("subtracts", () => {
    expect(2 - 1).toBe(1);
  });
});
`;
  const gate = { uses: "core/tests-not-weakened@1" };
  const files = {
    "src/math.test.js": TEST,
    "tests/test_api.py": "async def test_ok():\n    assert True\n",
    "package.json": '{"scripts":{"test":"npm run test:unit","test:unit":"vitest run"}}\n',
  };
  it.each([
    ["deletes a test file in a form the counter does not know", [{ delete: "tests/test_api.py" }], /deleted/],
    [
      "comments a test out",
      [write("src/math.test.js", TEST.replace('it("subtracts"', '/*\nit("subtracts"').concat("*/\n"))],
      /fewer tests/,
    ],
    [
      "marks a test only",
      [write("src/math.test.js", TEST.replace('it("adds"', 'it.only("adds"'))],
      /skip, todo or only/,
    ],
    [
      "changes an assertion and adds an empty test to hide it",
      [write("src/math.test.js", `${TEST.replace("toBe(2)", "toBeDefined()")}it("noop", () => {});\n`)],
      /assertion/,
    ],
    [
      "changes a script the test script calls",
      [write("package.json", '{"scripts":{"test":"npm run test:unit","test:unit":"true"}}\n')],
      /script/,
    ],
  ])("fails a change that %s", (_name, steps, says) => {
    const repo = one(gate, { steps: steps as unknown[], files });
    repo.sf("run");
    expect(status(repo)).toEqual(["fail"]);
    expect(evidenceOf(repo)[0]).toMatch(says);
  });

  it.each([
    [
      "renames a test file without changing it",
      [{ delete: "src/math.test.js" }, write("src/arith.test.js", TEST)],
    ],
    ["re-indents assertions inside a new describe", [write("src/math.test.js", WRAPPED)]],
  ])("passes a change that %s", (_name, steps) => {
    const repo = one(gate, { steps: steps as unknown[], files });
    repo.sf("run");
    expect(status(repo), evidenceOf(repo)[0]).toEqual(["pass"]);
  });
});

describe("the test floor", () => {
  const gate = { uses: "core/test-floor@1" };
  const files = { "run-tests.sh": RUNNER, "t/one.test.sh": "true\n", "t/two.test.sh": "true\n" };
  it("fails when the pattern captures something that is not a number", () => {
    const repo = one(
      { ...gate, with: { pattern: "ran (\\S+) checks" } },
      {
        steps: [write("result.txt", "ran no checks\n")],
        files: { "result.txt": "ran 4 checks\n" },
        verify: "cat result.txt",
      },
    );
    repo.sf("run");
    expect(status(repo)).toEqual(["fail"]);
  });

  it("fails when no test runs at all", () => {
    const repo = one(gate, { steps: [write("src/a.txt", "a\n")], files: { "run-tests.sh": RUNNER } });
    repo.sf("run");
    expect(status(repo)).toEqual(["fail"]);
    expect(evidenceOf(repo)[0]).toMatch(/No tests ran/);
  });

  it("measures the base commit in a checkout that was set up too", () => {
    const repo = one(gate, {
      steps: [write("t/three.test.sh", "true\n")],
      files,
      setup: "touch .setup-ran",
      verify: "test -f .setup-ran && sh run-tests.sh",
    });
    repo.sf("run");
    expect(status(repo)).toEqual(["pass"]);
    expect(evidenceOf(repo)[0]).toMatch(/3 tests.*base commit ran 2/s);
  });
});

describe("new tests fail on base", () => {
  const gate = { uses: "core/new-tests-fail-on-base@1" };
  it("does not take a renamed test file for a new test", () => {
    const repo = one(gate, {
      steps: [write("feature.txt", "x\n"), { delete: "t/one.test.sh" }, write("t/renamed.test.sh", "true\n")],
      files: { "run-tests.sh": RUNNER, "t/one.test.sh": "true\n" },
    });
    repo.sf("run");
    expect(status(repo)).toEqual(["pass"]);
    expect(evidenceOf(repo)[0]).toMatch(/no new tests/);
  });

  it("keeps a new test file executable when it puts it on the base commit", () => {
    // this suite runs each test file directly, so a copy that lost its mode would fail for the wrong reason
    const direct = 'for t in t/*.test.sh; do "./$t" || exit 1; done';
    const repo = one(gate, {
      steps: [
        write("feature.txt", "x\n"),
        write("t/lazy.test.sh", "#!/bin/sh\ntrue\n", { executable: true }),
      ],
      files: { "t/one.test.sh": "#!/bin/sh\ntrue\n" },
      verify: `chmod +x t/one.test.sh; ${direct}`,
    });
    repo.sf("run");
    expect(status(repo)).toEqual(["fail"]);
    expect(evidenceOf(repo)[0]).toMatch(/pass without the change/);
  });

  it("fails when the base commit's suite is already red: it cannot tell", () => {
    const repo = one(gate, {
      steps: [write("feature.txt", "x\n"), write("t/lazy.test.sh", "true\n")],
      files: { "run-tests.sh": RUNNER, "t/one.test.sh": "false\n" },
    });
    repo.sf("run");
    expect(status(repo)).toEqual(["fail"]);
    expect(evidenceOf(repo)[0]).toMatch(/already fails/);
  });
});

describe("every gate's record", () => {
  it("names the tree it checked and a hashed evidence file", () => {
    const repo = flowRepo({
      commands: { verify: "sh run-tests.sh" },
      gates: {
        paths: { uses: "core/protected-paths@1", onFail: "fail" },
        kept: { uses: "core/tests-not-weakened@1", onFail: "fail" },
        verify: { uses: "core/command@1", with: { command: "verify" }, onFail: "fail" },
        floor: { uses: "core/test-floor@1", onFail: "fail" },
        proves: { uses: "core/new-tests-fail-on-base@1", onFail: "fail" },
      },
      lanes: [
        agentLane("build", {
          agent: { access: "write" },
          gates: ["paths", "kept", "verify", "floor", "proves"],
        }),
      ],
      scripts: {
        author: {
          build: [
            write("feature.txt", "x\n"),
            write("t/feature.test.sh", "test -f feature.txt\n"),
            commit,
            pass(),
          ],
        },
      },
      files: { "run-tests.sh": RUNNER, "t/one.test.sh": "true\n" },
    });
    expect(repo.sf("run").status).toBe(0);
    const [r] = repo.rows<{ head_commit: string }>("select head_commit from runs");
    const tree = repo.git("rev-parse", `${r?.head_commit}^{tree}`);
    const rows = repo.rows<{ gate: string; tree_hash: string; output_path: string; output_sha256: string }>(
      "select * from gate_results order by id",
    );
    expect(rows.map((g) => g.gate)).toEqual(["paths", "kept", "verify", "floor", "proves"]);
    for (const g of rows) {
      expect(g.tree_hash, g.gate).toBe(tree);
      expect(
        createHash("sha256")
          .update(readFileSync(join(repo.dir, g.output_path)))
          .digest("hex"),
        g.gate,
      ).toBe(g.output_sha256);
    }
  });
});
