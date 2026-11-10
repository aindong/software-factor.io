// The sample plugin in this repository installs and its workflow runs to the end, and the index
// that ships here names it.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { Manifest } from "../../src/core/plugins/manifest.ts";
import { commandLane, commitFile, flowRepo, pass } from "../helpers/repo.ts";

it("installs from its folder and runs its workflow to the end on the fake agent", () => {
  const repo = flowRepo({
    lanes: [commandLane("build", "true")],
    files: { "inbox/first.md": "# Say hello\n\nWrite a greeting.\n" },
    scripts: { author: { build: [...commitFile("hello.txt"), pass()] } },
  });
  const added = repo.sf("add", resolve("plugins/sample"), "--yes");
  expect(added.status, added.stderr).toBe(0);
  const factory = repo.json<Record<string, unknown>>(".factor/factory.json");
  repo.write(".factor/factory.json", JSON.stringify({ ...factory, workflow: "sample-flow" }));
  // as a person would: the workflow the plugin brought is committed. It names the gate's word itself.
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "use the sample workflow");
  const r = repo.sf("run");
  expect(repo.rows("select status from runs"), r.stdout + r.stderr).toEqual([{ status: "done" }]);
  expect(repo.rows<{ title: string }>("select title from tasks").map((t) => t.title)).toEqual(["Say hello"]);
  // the plugin's own lane type and gate did the work, not core ones
  expect(repo.rows("select lane, outcome from lane_runs order by id")).toEqual([
    { lane: "hello", outcome: "pass" },
    { lane: "build", outcome: "pass" },
  ]);
  expect(repo.rows("select uses, status from gate_results")).toEqual([
    { uses: "sample/no-word@1", status: "pass" },
  ]);
});

it("fails the sample's gate when the run leaves the word in a file it changed", () => {
  const repo = flowRepo({
    lanes: [commandLane("build", "true")],
    files: { "inbox/first.md": "# Say hello\n\nWrite a greeting.\n" },
    scripts: { author: { build: [...commitFile("hello.txt", "FIXME: say more\n"), pass()] } },
  });
  expect(repo.sf("add", resolve("plugins/sample"), "--yes").status).toBe(0);
  const factory = repo.json<Record<string, unknown>>(".factor/factory.json");
  repo.write(".factor/factory.json", JSON.stringify({ ...factory, workflow: "sample-flow" }));
  repo.sf("run");
  expect(repo.rows("select uses, status from gate_results")).toEqual([
    { uses: "sample/no-word@1", status: "fail" },
  ]);
});

it("is named by the index that ships with this repository", () => {
  const index = JSON.parse(readFileSync("directory/index.json", "utf8")) as {
    version: number;
    plugins: { name: string; description: string; source: string }[];
  };
  const manifest = Manifest.parse(JSON.parse(readFileSync("plugins/sample/factor-plugin.json", "utf8")));
  expect(index.version).toBe(1);
  const entry = index.plugins.find((p) => p.name === manifest.name);
  expect(entry?.source).toBe("aindong/software-factor.io/plugins/sample");
  expect(entry?.description.length).toBeGreaterThan(10);
});
