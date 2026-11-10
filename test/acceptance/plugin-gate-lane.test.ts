// A plugin's lane type and gate run as commands in the run's checkout, with their settings.
import { expect, it } from "vitest";
import { callsOf, installed, makePlugin, useFlow } from "../helpers/plugin.ts";
import { commitFile, flowRepo, pass, trail } from "../helpers/repo.ts";

const repoWith = (content: string) =>
  flowRepo({
    lanes: [],
    scripts: { author: { build: [...commitFile("notes.txt", content), pass()] } },
  });

it("passes a run through the plugin's lane and gate, with the settings and the plugin's folder in their environment", () => {
  const repo = repoWith("all good\n");
  const plugin = makePlugin();
  expect(repo.sf("add", plugin.dir, "--yes").status).toBe(0);
  useFlow(repo);
  const r = repo.sf("run");
  expect(trail(repo), r.stdout + r.stderr).toEqual(["note:pass", "build:pass"]);
  expect(repo.rows("select status from runs")).toEqual([{ status: "done" }]);
  const calls = callsOf(plugin);
  expect(calls.find((c) => c.startsWith("lane "))).toMatch(
    new RegExp(`^lane \\{"say":"hello"\\} \\S+ ${installed(repo)}$`),
  );
  expect(calls.find((c) => c.startsWith("gate "))).toMatch(
    new RegExp(`^gate \\{"strict":true\\} \\S+ ${installed(repo)}$`),
  );
  // the gate's result is kept like a command gate's: its type, its exit, its output
  expect(repo.rows("select gate, uses, status, exit_code from gate_results")).toEqual([
    { gate: "fixme", uses: "acme/no-fixme@1", status: "pass", exit_code: 0 },
  ]);
});

it("fails the lane when the plugin's gate exits with an error", () => {
  const repo = repoWith("FIXME later\n");
  const plugin = makePlugin();
  expect(repo.sf("add", plugin.dir, "--yes").status).toBe(0);
  useFlow(repo);
  repo.sf("run");
  expect(trail(repo)).toEqual(["note:pass", "build:fail"]);
  expect(repo.rows("select status from gate_results")).toEqual([{ status: "fail" }]);
});

it("fails the plugin's lane when its command exits with an error", () => {
  const repo = repoWith("all good\n");
  const plugin = makePlugin();
  expect(repo.sf("add", plugin.dir, "--yes").status).toBe(0);
  useFlow(repo, (w) => {
    const [note] = w.lanes as { with?: unknown }[];
    if (note) note.with = { say: "fail" };
  });
  repo.sf("run");
  expect(trail(repo)).toEqual(["note:fail"]);
});
