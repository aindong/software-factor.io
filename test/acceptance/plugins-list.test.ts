import { readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGENTS } from "../../src/core/accounts.ts";
import { GATES } from "../../src/core/gates/index.ts";
import { BUILTINS } from "../../src/core/schema/builtins.ts";
import { op, tool } from "../helpers/operator.ts";
import { agentLane, flowRepo, startUi, type Ui } from "../helpers/repo.ts";

interface Plugins {
  lanes: string[];
  gates: string[];
  collectors: string[];
  agents: string[];
  workflows: { name: string; description: string }[];
  installing: string;
}
const repo = flowRepo({ lanes: [agentLane("build")] });
let ui: Ui;
beforeAll(async () => {
  ui = await startUi(repo);
}, 120_000);
afterAll(() => ui?.stop());

describe("what is built in", () => {
  it("is listed by its real names, from the code's own tables", async () => {
    const { body } = await op<Plugins>(ui, "plugins_list");
    expect(body.lanes).toEqual(Object.keys(BUILTINS.lane));
    expect(body.gates).toEqual(Object.keys(BUILTINS.gate));
    expect(body.collectors).toEqual(Object.keys(BUILTINS.collector));
    expect(body.agents).toEqual([...AGENTS, "fake"]);
    // every gate the checker knows is one the engine can run
    expect(Object.keys(GATES).sort()).toEqual([...body.gates].sort());
  });

  it("lists the workflows that come with this version, with what each is for", async () => {
    const { body } = await op<Plugins>(ui, "plugins_list");
    const shipped = readdirSync("workflows")
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .sort();
    expect(body.workflows.map((w) => w.name)).toEqual(shipped);
    expect(shipped).toEqual(expect.arrayContaining(["alleo-loop", "bugfix-fast", "research-only"]));
    for (const w of body.workflows) expect(w.description.length, w.name).toBeGreaterThan(10);
  });

  it("says that installing more is not built yet", async () => {
    const { body } = await op<Plugins>(ui, "plugins_list");
    expect(body.installing).toMatch(/not built yet/);
  });

  it("is the same through the MCP server and on the command line", async () => {
    const { body } = await op<Plugins>(ui, "plugins_list");
    expect(tool<Plugins>(repo, "plugins_list").data).toEqual(body);
    const printed = repo.sf("plugins").stdout;
    for (const name of [
      ...body.lanes,
      ...body.gates,
      ...body.collectors,
      ...body.agents,
      ...body.workflows.map((w) => w.name),
    ]) {
      expect(printed, name).toContain(name);
    }
    expect(printed).toMatch(/not built yet/);
  });
});
