// A fixture for one eval case: a small repository with a factory in it, on a factor home of its
// own, where the scripted agent works the one lane. Nothing of the person's workspace or of
// their factor home is read or written.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { FakeAction } from "../config.ts";
import { runNext } from "../engine/schedule.ts";
import { loadWorkspace } from "../workspace.ts";
import { TESTS } from "./cases.ts";

type Json = Record<string, unknown>;
export interface Fixture {
  dir: string;
  /** One run of the fixture's one task, to wherever it ends. */
  run: () => Promise<void>;
  rows: <T>(sql: string, ...args: (string | number)[]) => T[];
  remove: () => void;
}

const WORKFLOW = (on: Json) => ({
  $schema: "https://softwarefactor.io/schema/workflow/v1.json",
  version: 1,
  name: "eval",
  description: "One lane with every gate, for the factory's own evals.",
  roles: { author: { description: "Does the task." } },
  limits: { minutes: 10, tokens: 100000 },
  commands: { verify: { description: "The project's tests." } },
  collectors: [{ id: "tasks", uses: "core/file@1", with: { path: ".factor/tasks.md" } }],
  gates: {
    protected: { uses: "core/protected-paths@1", onFail: "fail" },
    "tests-kept": { uses: "core/tests-not-weakened@1", onFail: "fail" },
    secrets: { uses: "core/no-secrets@1", onFail: "fail" },
    "new-tests": { uses: "core/new-tests-fail-on-base@1", onFail: "fail" },
    verify: { uses: "core/command@1", with: { command: "verify" }, onFail: "fail" },
  },
  lanes: [
    {
      id: "build",
      uses: "core/agent@1",
      agent: { role: "author", access: "write", prompt: "Do the task." },
      gates: ["protected", "tests-kept", "secrets", "new-tests", "verify"],
      checkpoint: "out",
      on,
    },
  ],
});

/** `script` is what the agent does at each visit of the lane, or a list of them, one for each visit. */
export function makeFixture(o: { script: FakeAction[] | FakeAction[][]; on?: Json }): Fixture {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "sf-eval-")));
  const dir = join(top, "repo");
  const home = join(top, "home");
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify({ name: "fixture", type: "module", scripts: { test: "node --test" } }, null, 2)}\n`,
    "sum.js": "export const sum = (a, b) => a + b;\n",
    "sum.test.js": TESTS,
    ".gitignore": ".factor/state.db*\n.factor/runs/\n.factor/local.json\n",
    ".factor/factory.json": `${JSON.stringify({ version: 1, workflow: "eval", commands: { verify: "node --test" } }, null, 2)}\n`,
    ".factor/workflows/eval.json": `${JSON.stringify(WORKFLOW(o.on ?? { pass: "@done", fail: "@stop" }), null, 2)}\n`,
    ".factor/local.json": `${JSON.stringify({ roles: { author: { adapter: "fake", script: { build: o.script } } } }, null, 2)}\n`,
    ".factor/tasks.md": "- [ ] The task of this case\n",
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "eval@softwarefactor.invalid");
  git("config", "user.name", "softwarefactor eval");
  git("add", "-A");
  git("commit", "-q", "-m", "a fixture");
  return {
    dir,
    run: async () => {
      // the factor home is read when it is needed: for this run it is the fixture's own
      const before = process.env.FACTOR_HOME;
      process.env.FACTOR_HOME = home;
      try {
        await runNext(loadWorkspace(dir));
      } finally {
        if (before === undefined) delete process.env.FACTOR_HOME;
        else process.env.FACTOR_HOME = before;
      }
    },
    rows: <T>(sql: string, ...args: (string | number)[]) => {
      const db = new DatabaseSync(join(dir, ".factor/state.db"), { readOnly: true });
      try {
        return db.prepare(sql).all(...args) as T[];
      } finally {
        db.close();
      }
    },
    remove: () => rmSync(top, { recursive: true, force: true }),
  };
}
