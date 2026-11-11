import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Repo } from "./repo.ts";

/**
 * Gives an initialised repository the one-lane workflow that `init` used to write: one agent lane at
 * `in`, the verify gate, and a scripted `author` that writes a hello file. For tests that need some
 * small workflow, not the starter itself.
 */
export function oneLane(repo: Repo): void {
  repo.write(
    ".factor/workflows/starter.json",
    readFileSync(resolve("test/fixtures/workflows/one-lane.json"), "utf8"),
  );
  const { ship: _ship, ...commands } = repo.json<{ commands: Record<string, string> }>(
    ".factor/factory.json",
  ).commands;
  repo.write(
    ".factor/factory.json",
    `${JSON.stringify({ version: 1, workflow: "starter", commands }, null, 2)}\n`,
  );
  const hello = [
    { write: { path: "FACTOR-HELLO.md", content: "Hello from the scripted agent.\n" } },
    { commit: "Say hello from the factory" },
    { handoff: { outcome: "pass", summary: "Added FACTOR-HELLO.md." } },
  ];
  const roles = { author: { adapter: "fake", script: { "*": hello } } };
  repo.write(".factor/local.json", `${JSON.stringify({ roles }, null, 2)}\n`);
}
