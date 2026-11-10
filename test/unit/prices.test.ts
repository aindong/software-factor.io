import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { priceOf } from "../../src/core/prices.ts";

process.env.FACTOR_HOME = mkdtempSync(join(tmpdir(), "sf-home-"));
const used = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 };

describe("pricing a usage", () => {
  it("prices each kind of token, with cache-write at the input price when it has none", () => {
    expect(priceOf("gpt-5.3-codex", used)).toBeCloseTo(1.75 + 14 + 0.175 + 1.75, 9);
  });

  it("has no price for a model that is not in the table, or not named", () => {
    expect(priceOf("made-up", used)).toBeUndefined();
    expect(priceOf(undefined, used)).toBeUndefined();
  });

  it.each(["constructor", "toString", "__proto__"])("has no price for a model named %s", (model) => {
    expect(priceOf(model, used)).toBeUndefined();
  });
});
