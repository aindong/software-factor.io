import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { parseWorkflow } from "../../src/core/schema/parse.ts";
import { workflowJsonSchema } from "../../src/core/schema/workflow.ts";

const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const examples = ["alleo-loop", "bugfix-fast", "research-only"];

describe("the three example workflows", () => {
  it.each(examples)("%s parses with no problems", (name) => {
    const result = parseWorkflow(load(`workflows/${name}.json`));
    expect(result.problems).toEqual([]);
    expect(result.workflow?.name).toBe(name);
  });

  it("are three different processes", () => {
    const loop = JSON.stringify(load("workflows/alleo-loop.json"));
    expect(loop).toContain('"maxRounds"');
    expect(loop).toContain('"panel"');
    expect(JSON.stringify(load("workflows/research-only.json"))).not.toContain("core/test-floor@1");
    expect(load("workflows/bugfix-fast.json").lanes).toHaveLength(2);
  });
});

describe("the published JSON Schema", () => {
  const published = load("schema/workflow.v1.json");
  const validate = new Ajv({ strict: false }).compile(published);

  it("is the one generated from the Zod source", () => {
    expect(published).toEqual(workflowJsonSchema());
  });

  it.each(examples)("accepts %s", (name) => {
    validate(load(`workflows/${name}.json`));
    expect(validate.errors ?? []).toEqual([]);
  });

  it("rejects a workflow with an unknown key", () => {
    const broken = { ...load("workflows/bugfix-fast.json"), surprise: true };
    expect(validate(broken)).toBe(false);
  });

  it("rejects an unknown key inside a lane and inside its agent settings", () => {
    const inLane = load("workflows/bugfix-fast.json");
    inLane.lanes[0].surprise = true;
    expect(validate(inLane)).toBe(false);
    const inAgent = load("workflows/bugfix-fast.json");
    inAgent.lanes[0].agent.surprise = true;
    expect(validate(inAgent)).toBe(false);
  });
});
