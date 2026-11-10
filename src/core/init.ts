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

const STARTER = {
  $schema: SCHEMA_URL,
  version: 1,
  name: "starter",
  description:
    "One lane: an agent does the task, then the host runs this project's verify command on the committed work.",
  roles: { author: { description: "Does the task and commits the work." } },
  limits: { minutes: 60, tokens: 4000000 },
  commands: {
    verify: { description: "Runs this project's checks on a clean checkout. Exits 0 only when they pass." },
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
      onFail: "fail",
      description: "The project's own checks pass on the committed work.",
    },
  },
  lanes: [
    {
      id: "work",
      name: "Work",
      uses: "core/agent@1",
      agent: {
        role: "author",
        access: "write",
        prompt:
          "Do the task below. Commit your work. In your hand-off, say what you changed and how it can be checked.",
      },
      gates: ["protected", "tests-kept", "verify"],
      checkpoint: "in",
      on: { pass: "@done", fail: "@stop" },
    },
  ],
};

const LOCAL = {
  roles: {
    author: {
      adapter: "fake",
      script: {
        "*": [
          {
            write: {
              path: "FACTOR-HELLO.md",
              content: "Hello from the scripted agent. Bind a real agent in .factor/local.json.\n",
            },
          },
          { commit: "Say hello from the factory" },
          { handoff: { outcome: "pass", summary: "Added FACTOR-HELLO.md." } },
        ],
      },
    },
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
  write(".factor/factory.json", json({ version: 1, workflow: "starter", commands: { verify } }));
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
