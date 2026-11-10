// core/no-secrets@1: a lane's change may not add something shaped like a secret.
import { expect, it } from "vitest";
import { agentLane, commitFile, flowRepo, pass, trail } from "../helpers/repo.ts";

// made at run time: this file holds no token
const token = `ghp_${"a1B2".repeat(9)}`;
const gates = {
  secrets: { uses: "core/no-secrets@1", onFail: "fail" },
  verify: { uses: "core/command@1", with: { command: "verify" }, onFail: "fail" },
};
const repoWith = (content: string, files: Record<string, string> = {}) =>
  flowRepo({
    lanes: [agentLane("build", { agent: { access: "write" }, gates: ["secrets", "verify"] })],
    gates,
    files,
    scripts: { author: { build: [...commitFile("config.js", content), pass()] } },
  });

it("fails a change that adds a secret, names the file and the line, and does not print the secret", () => {
  const repo = repoWith(`export const name = "shop";\nexport const key = "${token}";\n`);
  repo.sf("run");
  expect(trail(repo)).toEqual(["build:fail"]);
  const [gate] = repo.rows<{ gate: string; status: string; output_path: string }>(
    "select gate, status, output_path from gate_results where gate = 'secrets'",
  );
  expect(gate).toMatchObject({ gate: "secrets", status: "fail" });
  const output = repo.read(gate?.output_path ?? "");
  expect(output).toMatch(/config\.js:2: /);
  expect(output).not.toContain(token);
});

it("passes a change with no secret, and one that only leaves a line that was there before", () => {
  const clean = repoWith('export const name = "shop";\n');
  clean.sf("run");
  expect(trail(clean)).toEqual(["build:pass"]);

  // the base commit already holds the line: the lane did not add it
  const old = repoWith(`export const key = "${token}";\nexport const name = "shop";\n`, {
    "config.js": `export const key = "${token}";\n`,
  });
  old.sf("run");
  expect(trail(old)).toEqual(["build:pass"]);
});

// ---- from the review

it("fails a change whose history holds a secret that a later commit took out", () => {
  const repo = flowRepo({
    lanes: [agentLane("build", { agent: { access: "write" }, gates: ["secrets", "verify"] })],
    gates,
    scripts: {
      author: {
        build: [
          ...commitFile("config.js", `export const key = "${token}";\n`),
          ...commitFile("config.js", "export const key = process.env.KEY;\n"),
          pass(),
        ],
      },
    },
  });
  repo.sf("run");
  expect(trail(repo)).toEqual(["build:fail"]);
});

it("finds a secret in a file of more than a megabyte, and shows no more than its first characters", () => {
  const big = `${"// filler line of an ordinary lock file\n".repeat(40_000)}token = "${token}"\n`;
  const repo = repoWith(big);
  repo.sf("run");
  expect(trail(repo)).toEqual(["build:fail"]);
  const [gate] = repo.rows<{ output_path: string }>(
    "select output_path from gate_results where gate = 'secrets'",
  );
  const output = repo.read(gate?.output_path ?? "");
  expect(output).toMatch(/config\.js:40001: /);
  expect(output).not.toContain(token.slice(0, 8));
});

it("does not take a local address or a placeholder in a README for a secret", () => {
  const repo = flowRepo({
    lanes: [agentLane("build", { agent: { access: "write" }, gates: ["secrets", "verify"] })],
    gates,
    scripts: {
      author: {
        build: [
          ...commitFile(
            "README.md",
            "Run it with DATABASE_URL=postgres://postgres:postgres@localhost/shop\nGET /items?key=YOUR_API_KEY&sort_key=created_at\n",
          ),
          pass(),
        ],
      },
    },
  });
  repo.sf("run");
  expect(trail(repo)).toEqual(["build:pass"]);
});

it("reads a file that the repository marks as not to be compared", () => {
  const repo = repoWith(`key = "${token}"\n`, { ".gitattributes": "* -diff\n" });
  repo.sf("run");
  expect(trail(repo)).toEqual(["build:fail"]);
});
