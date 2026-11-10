// Every collector type the schema lets a workflow name has a collector behind it, and no other.
import { expect, it } from "vitest";
import { COLLECTORS } from "../../src/core/collectors/index.ts";
import { BUILTINS } from "../../src/core/schema/builtins.ts";

it("has a collector for each built-in type the schema knows, and for nothing else", () => {
  expect(Object.keys(COLLECTORS).sort()).toEqual(Object.keys(BUILTINS.collector).sort());
  for (const collect of Object.values(COLLECTORS)) expect(collect).toBeTypeOf("function");
});
