// core/no-secrets@1, from the second review: what is let through as an example must be one.
import { expect, it } from "vitest";
import { agentLane, commitFile, flowRepo, pass, trail } from "../helpers/repo.ts";

// made at run time: this file holds no token
const token = `ghp_${"a1B2".repeat(9)}`;
const gates = {
  secrets: { uses: "core/no-secrets@1", onFail: "fail" },
  verify: { uses: "core/command@1", with: { command: "verify" }, onFail: "fail" },
};
const repoWith = (script: unknown[], files: Record<string, string> = {}) =>
  flowRepo({
    lanes: [agentLane("build", { agent: { access: "write" }, gates: ["secrets", "verify"] })],
    gates,
    files,
    scripts: { author: { build: [...script, pass()] } },
  });

it.each([
  "git.local.acme.io",
  "localhost.acme.io",
  "example.com.acme.io",
  "db.test-eu.acme.io",
  "localhost:8080",
])(
  "fails a token in a URL to %s: a host that only looks local, or a real token wherever it points",
  (host) => {
    const repo = repoWith(commitFile("deploy.sh", `git clone https://deploy:${token}@${host}/shop.git\n`));
    repo.sf("run");
    expect(trail(repo)).toEqual(["build:fail"]);
  },
);

it("fails a password in a URL to a host that only starts like a local one, and passes the local one", () => {
  const real = repoWith(commitFile("notes.md", "postgres://shop:Tr0ub4dor@db.local.acme.io/shop\n"));
  real.sf("run");
  expect(trail(real)).toEqual(["build:fail"]);
  const local = repoWith(commitFile("notes.md", "postgres://shop:Tr0ub4dor@db.local:5432/shop\n"));
  local.sf("run");
  expect(trail(local)).toEqual(["build:pass"]);
});

it("passes a line with an old secret that the change only moved within its file", () => {
  const repo = repoWith(commitFile("config.js", `const a = 1;\nconst b = 2;\nconst key = "${token}";\n`), {
    "config.js": `const key = "${token}";\nconst a = 1;\nconst b = 2;\n`,
  });
  repo.sf("run");
  expect(trail(repo)).toEqual(["build:pass"]);
});

it("fails a secret written into a commit's message", () => {
  const repo = repoWith([
    { write: { path: "notes.md", content: "rotated the key\n" } },
    { commit: `rotate the key, the old one was ${token}` },
  ]);
  repo.sf("run");
  expect(trail(repo)).toEqual(["build:fail"]);
  const [gate] = repo.rows<{ output_path: string }>(
    "select output_path from gate_results where gate = 'secrets'",
  );
  expect(repo.read(gate?.output_path ?? "")).toMatch(/the message of commit [0-9a-f]{7,}/);
});

it("reads a file whose name has a space, under a person's own diff settings", () => {
  const repo = repoWith(commitFile("my config.js", `one\ntwo\nthree\nkey = "${token}"\n`), {
    "my config.js": "one\ntwo\nthree\n",
  });
  repo.sf("run");
  expect(trail(repo)).toEqual(["build:fail"]);
  const [gate] = repo.rows<{ output_path: string }>(
    "select output_path from gate_results where gate = 'secrets'",
  );
  expect(repo.read(gate?.output_path ?? "")).toMatch(/^my config\.js:4: /m);
});
