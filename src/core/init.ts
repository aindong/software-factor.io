// `softwarefactor init`: the smallest factory that runs. It never overwrites a file that exists.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./git.ts";
import { SCHEMA_URL } from "./schema/workflow.ts";

const NO_VERIFY = `echo "No test command was found. Set commands.verify in .factor/factory.json." && exit 1`;

/** The project's own test command, when it is plain to see. */
function detectVerify(root: string): string {
  const has = (f: string) => existsSync(join(root, f));
  if (has("package.json")) {
    try {
      const test = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts?.test as
        | string
        | undefined;
      if (test && !test.includes("no test specified")) {
        const pm = has("pnpm-lock.yaml")
          ? "pnpm"
          : has("yarn.lock")
            ? "yarn"
            : has("bun.lock") || has("bun.lockb")
              ? "bun"
              : "npm";
        return `${pm} test`;
      }
    } catch {
      // an unreadable package.json is the project's problem, not init's
    }
  }
  if (has("Cargo.toml")) return "cargo test";
  if (has("go.mod")) return "go test ./...";
  if (has("pyproject.toml") || has("pytest.ini")) return "pytest";
  return NO_VERIFY;
}

// Delivers the run's branch into the branch the workspace is on, here on this machine. The title
// comes from the environment, so no value is pasted into the line. Nothing is pushed, and its last
// line says so: that line is what the run shows when it is done.
const SHIP =
  'root=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)") && branch=$(git rev-parse --abbrev-ref HEAD) && git -C "$root" merge -q --no-ff "$branch" -m "Merge $branch: $FACTOR_TASK_TITLE" && echo "Merged $branch into $(git -C "$root" rev-parse --abbrev-ref HEAD) as $(git -C "$root" rev-parse --short HEAD), on this machine. Nothing was pushed."';

const plan = { plan: "plan.outputs.plan" };

const STARTER = {
  $schema: SCHEMA_URL,
  version: 1,
  name: "starter",
  description:
    "Plans, builds, reviews, tests and ships one task, with a person approving the plan and the ship.",
  roles: {
    author: { description: "Plans the task and writes the change." },
    reviewer: {
      description:
        "Reads the change and tries to break it. Best on another vendor's login than the author's.",
    },
    tester: { description: "Tries the change the way its user would." },
  },
  limits: { minutes: 120, tokens: 8000000 },
  commands: {
    verify: { description: "Runs this project's checks on a clean checkout. Exits 0 only when they pass." },
    ship: {
      description:
        "Delivers the change. As init writes it: merges the run's branch into the branch you started from, on this machine. Nothing is pushed.",
    },
  },
  collectors: [{ id: "tasks", uses: "core/file@1", with: { path: ".factor/tasks.md" } }],
  gates: {
    protected: {
      uses: "core/protected-paths@1",
      onFail: "stop",
      description: "The change touches no CI, agent configuration, factory or lock file.",
    },
    "tests-kept": {
      uses: "core/tests-not-weakened@1",
      onFail: "stop",
      description: "No test was deleted, skipped or weakened.",
    },
    verify: {
      uses: "core/command@1",
      with: { command: "verify" },
      onFail: "repair",
      description: "The project's own checks pass on the committed work.",
    },
  },
  lanes: [
    {
      id: "plan",
      name: "Plan",
      uses: "core/agent@1",
      agent: {
        role: "author",
        access: "read",
        prompt:
          "Read the task below and the code it touches. Write a short plan: what will change, and how each part will be checked. Change no file. Where the task is unclear, choose, and say in the plan what you chose.",
      },
      outputs: { plan: { type: "string", required: true, description: "The plan, as text." } },
      limits: { repairRounds: 1 },
      checkpoint: "in",
      on: { pass: "build", fail: "@stop" },
    },
    {
      id: "build",
      name: "Build",
      uses: "core/agent@1",
      agent: {
        role: "author",
        access: "write",
        prompt:
          "Do the task as the plan says. Add or change a test for what you change, where the project has tests. Commit your work. In your hand-off, say what you changed and how it can be checked. If you are here because a later lane failed, fix what its hand-off lists and nothing else.",
      },
      inputs: plan,
      gates: ["protected", "tests-kept", "verify"],
      limits: { repairRounds: 2 },
      checkpoint: "near",
      on: { pass: "review", fail: "@stop" },
    },
    {
      id: "review",
      name: "Review",
      uses: "core/agent@1",
      agent: {
        role: "reviewer",
        access: "read",
        prompt:
          "Read the change against the task and the plan. Fail the lane only for a fault you can show, and say how to reproduce it.",
      },
      inputs: plan,
      limits: { repairRounds: 1 },
      checkpoint: "near",
      on: { pass: "test", fail: [{ to: "build", maxRounds: 2 }, { to: "@stop" }] },
    },
    {
      id: "test",
      name: "Test",
      uses: "core/agent@1",
      agent: {
        role: "tester",
        access: "read",
        prompt:
          "Try the change the way its user would: run it, and try the cases the task names and the edges around them. Change no file. Fail the lane with the steps that show the fault.",
      },
      limits: { repairRounds: 1 },
      checkpoint: "near",
      on: { pass: "ship", fail: [{ to: "build", maxRounds: 1 }, { to: "@stop" }] },
    },
    {
      id: "ship",
      name: "Ship",
      uses: "core/command@1",
      with: { command: "ship" },
      checkpoint: "in",
      on: { pass: "@done", fail: "@stop" },
    },
  ],
};

const handoff = (summary: string, outputs?: Record<string, string>) => ({
  handoff: { outcome: "pass", summary, ...(outputs ? { outputs } : {}) },
});
const fake = (script: Record<string, unknown[]>) => ({ adapter: "fake", script });

// The scripted stand-in, so the first run costs nothing. A read-only lane writes and commits nothing.
const LOCAL = {
  roles: {
    author: fake({
      plan: [handoff("Planned one new file.", { plan: "Add FACTOR-HELLO.md with one line, and commit it." })],
      build: [
        {
          write: {
            path: "FACTOR-HELLO.md",
            content: "Hello from the scripted agent. Bind a real agent in .factor/local.json.\n",
          },
        },
        { commit: "Say hello from the factory" },
        handoff("Added FACTOR-HELLO.md."),
      ],
    }),
    reviewer: fake({ review: [handoff("Read the change: one new file, as planned.")] }),
    tester: fake({ test: [handoff("Opened the file: it says hello.")] }),
  },
};

const TASKS = `# Tasks

One task per open box. Indented lines under a box are its description. The factory reads this file
and never edits it: tick a box yourself to take a task out of the queue.

- [ ] Say hello
  Add a file that proves the factory ran.
`;

const IGNORE = [".factor/state.db*", ".factor/runs/", ".factor/local.json"];

export interface InitResult {
  root: string;
  already: boolean;
  created: string[];
  verify: string;
  verifyDetected: boolean;
}

export function init(cwd: string): InitResult {
  const root = repoRoot(cwd);
  const dir = join(root, ".factor");
  const verify = detectVerify(root);
  const result: InitResult = {
    root,
    already: false,
    created: [],
    verify,
    verifyDetected: verify !== NO_VERIFY,
  };
  if (existsSync(join(dir, "factory.json"))) return { ...result, already: true };

  mkdirSync(join(dir, "workflows"), { recursive: true });
  const write = (rel: string, content: string) => {
    if (existsSync(join(root, rel))) return;
    writeFileSync(join(root, rel), content);
    result.created.push(rel);
  };
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  write(".factor/factory.json", json({ version: 1, workflow: "starter", commands: { verify, ship: SHIP } }));
  write(".factor/workflows/starter.json", json(STARTER));
  write(".factor/local.json", json(LOCAL));
  write(".factor/tasks.md", TASKS);

  const ignorePath = join(root, ".gitignore");
  const current = existsSync(ignorePath) ? readFileSync(ignorePath, "utf8") : "";
  const missing = IGNORE.filter((line) => !current.split("\n").includes(line));
  if (missing.length > 0) {
    appendFileSync(
      ignorePath,
      `${current === "" || current.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`,
    );
    result.created.push(".gitignore");
  }
  return result;
}
