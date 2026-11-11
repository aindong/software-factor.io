// The README is what a stranger follows: its links lead somewhere, its commands exist, it names
// every guide, and it says what has and has not run with real agents.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { AGENTS } from "../../src/core/accounts.ts";
import { HELP } from "../../src/core/help.ts";

const readme = readFileSync("README.md", "utf8");

it("links only to files that are there, and to every guide under docs", () => {
  const links = [...readme.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1] ?? "");
  const local = links.filter((l) => !/^https?:/.test(l)).map((l) => l.replace(/#.*$/, ""));
  expect(local.length).toBeGreaterThan(10);
  for (const path of local) expect(existsSync(path), path).toBe(true);
  for (const guide of readdirSync("docs").filter((f) => f.endsWith(".md")))
    expect(local, `docs/${guide}`).toContain(`docs/${guide}`);
});

it("shows only commands that the help lists", () => {
  const shown = new Set([...readme.matchAll(/softwarefactor ([a-z][a-z-]*)/g)].map((m) => m[1] ?? ""));
  expect(shown.size).toBeGreaterThan(8);
  for (const command of shown) expect(HELP, command).toMatch(new RegExp(`^  ${command}\\b`, "m"));
});

it("binds only a role the starter workflow has, and quotes the path of its alias", () => {
  expect(readme).toContain('alias softwarefactor="node \\"$PWD/dist/cli.js\\""');
  const real = readme.slice(
    readme.indexOf("## Use a real agent"),
    readme.indexOf("## The workflows that ship"),
  );
  const bound = [...real.matchAll(/softwarefactor role bind ([a-z]+)/g)].map((m) => m[1]);
  expect(bound).toEqual(["author"]); // `init` writes one role: binding another fails
  expect(real).toMatch(/reviewer/); // and the second role is named for the workflows that have one
});

it("has a quick start between its two markers, and holds no path of one machine", () => {
  const block =
    /<!-- quick-start:begin -->\n```sh\n([\s\S]*?)```\n<!-- quick-start:end -->/.exec(readme)?.[1] ?? "";
  for (const line of [
    "pnpm install",
    "pnpm run build",
    "softwarefactor init",
    "softwarefactor run",
    "softwarefactor approve <run>",
  ])
    expect(block, line).toContain(line);
  expect(readme).not.toMatch(/\/Volumes\/|\/Users\/|\/home\/[a-z]/);
});

it("says what has run with real agents and what only on the scripted agent, by name", () => {
  const from = readme.indexOf("## What has run with real agents, and what has not");
  expect(from).toBeGreaterThan(0);
  const section = readme.slice(from, readme.indexOf("\n## ", from + 5));
  const [real = "", standIn = ""] = section.split("Only on the scripted agent or a stand-in");
  expect(real).toContain("Run with real agents");
  // every adapter the source ships is named in one of the two lists, and only in that one
  expect([...AGENTS].sort()).toEqual(["claude", "codex", "command", "kimi"]); // and the scripted one, which needs no account
  for (const [name, ran] of [
    ["Claude Code", true],
    ["Codex", true],
    ["Kimi", false],
    ["`command` adapter", false],
    ["scripted agent", false],
  ] as const) {
    expect((ran ? real : standIn).includes(name), name).toBe(true);
    if (name !== "scripted agent")
      expect((ran ? standIn : real).includes(name), `${name} in the other list`).toBe(false);
  }
  for (const said of ["eval", "slots", "bugfix-fast", "research-only", "alleo-plan-check"])
    expect(standIn, said).toContain(said);
  // from the review: parts of alleo-loop that no real agent has run, and a gate no shipped workflow uses
  for (const said of ["verify-ui", "sent work back", "core/no-secrets@1"])
    expect(standIn, said).toContain(said);
  // who approved the checkpoints of the real runs is said in so many words
  expect(real).toContain("approved by the AI agent");
});
