// The list a role's model is chosen from: the models the product knows for the account's agent,
// newest first, then what the account has run on this machine, and a bound model the list does not know.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { modelChoices, modelLabel, withBound } from "../../src/core/models.ts";
import { readPrices } from "../../src/core/prices.ts";

process.env.FACTOR_HOME = mkdtempSync(join(tmpdir(), "sf-home-"));
const known = Object.keys(readPrices());
const values = (list: { value: string }[]) => list.map((c) => c.value);

describe("the name of a model, with its version", () => {
  it.each([
    ["claude-sonnet-5-5", "Sonnet 5.5 (claude-sonnet-5-5)"],
    ["claude-opus-5-5", "Opus 5.5 (claude-opus-5-5)"],
    ["claude-fable-5-1", "Fable 5.1 (claude-fable-5-1)"],
    ["claude-fable-5", "Fable 5 (claude-fable-5)"],
    ["claude-haiku-4-5", "Haiku 4.5 (claude-haiku-4-5)"],
    ["gpt-6.1-sol", "GPT-6.1 Sol (gpt-6.1-sol)"],
    ["gpt-6-luna", "GPT-6 Luna (gpt-6-luna)"],
    ["gpt-5.3-codex", "GPT-5.3 Codex (gpt-5.3-codex)"],
    ["sonnet", "sonnet"],
    ["made-up", "made-up"],
  ])("%s reads %s", (name, label) => {
    expect(modelLabel(name)).toBe(label);
  });
});

describe("the models of an agent", () => {
  it("lists Claude Code's models only, newest version first, as the price table orders a version", () => {
    const list = modelChoices("claude", known, []);
    expect(values(list)).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
      "claude-fable-5-1",
      "claude-fable-5",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ]);
    expect(list[1]).toEqual({ value: "claude-sonnet-5-5", label: "Sonnet 5.5 (claude-sonnet-5-5)" });
  });

  it("lists Codex's models only, newest version first", () => {
    expect(values(modelChoices("codex", known, []))).toEqual([
      "gpt-6.1-sol",
      "gpt-6.1-terra",
      "gpt-6-sol",
      "gpt-6-astra",
      "gpt-6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.3-codex",
    ]);
  });

  it("knows no model of an agent the price table has none of", () => {
    expect(modelChoices("command", known, [])).toEqual([]);
    expect(modelChoices("kimi", known, [])).toEqual([]);
  });
});

describe("what the account has run on this machine", () => {
  it("adds an alias with the version it last ran as, once, after the known models", () => {
    const list = modelChoices("claude", known, [
      { asked: "sonnet", model: "claude-sonnet-5-5" }, // the latest session comes first
      { asked: "sonnet", model: "claude-sonnet-5" },
      { asked: "claude-opus-5-5", model: "claude-opus-5-5" },
    ]);
    expect(list.filter((c) => c.value === "sonnet")).toEqual([
      { value: "sonnet", label: "sonnet (last ran as claude-sonnet-5-5)" },
    ]);
    expect(values(list).filter((v) => v === "claude-opus-5-5")).toHaveLength(1);
    expect(values(list).at(-1)).toBe("sonnet");
  });

  it("says the version an alias last ran as, when a later session of it said none", () => {
    const list = modelChoices("claude", known, [
      { asked: null, model: "sonnet" },
      { asked: "sonnet", model: "sonnet" },
      { asked: "sonnet", model: null },
      { asked: "sonnet", model: "claude-sonnet-5-5" },
      { asked: "sonnet", model: "claude-sonnet-5" },
    ]);
    expect(list.filter((c) => c.value === "sonnet")).toEqual([
      { value: "sonnet", label: "sonnet (last ran as claude-sonnet-5-5)" },
    ]);
  });

  it("adds a model it ran that the list does not know, and an asked model with no version said", () => {
    const list = modelChoices("claude", known, [
      { asked: null, model: "claude-next" },
      { asked: "opus", model: null },
    ]);
    expect(list.slice(-2)).toEqual([
      { value: "claude-next", label: "claude-next" },
      { value: "opus", label: "opus" },
    ]);
  });
});

describe("a model already bound", () => {
  const list = modelChoices("claude", known, [{ asked: "sonnet", model: "claude-sonnet-5-5" }]);

  it("is shown and kept when the list does not know it, at the top", () => {
    const kept = withBound(list, "my-own-model");
    expect(kept[0]).toEqual({ value: "my-own-model", label: "my-own-model" });
    expect(kept.slice(1)).toEqual(list);
  });

  it("is not added twice when the list knows it, and keeps the list's words for it", () => {
    expect(withBound(list, "claude-opus-5-5")).toEqual(list);
    expect(withBound(list, "sonnet")).toEqual(list);
    expect(withBound(list, undefined)).toEqual(list);
    expect(withBound(list, "")).toEqual(list);
  });
});
