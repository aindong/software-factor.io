// Prices for Claude models, for a session whose CLI printed its tokens and no cost.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { readPrices } from "../../src/core/prices.ts";
import { printingAccount } from "../helpers/cost.ts";
import { agentLane, flowRepo } from "../helpers/repo.ts";

const usage = {
  input_tokens: 1000,
  output_tokens: 200,
  cache_read_input_tokens: 5000,
  cache_creation_input_tokens: 300,
};
const printed = (model: string) => ({
  type: "result",
  is_error: false,
  result: "ok",
  session_id: "s",
  usage,
  modelUsage: { [model]: { costUSD: 1 } },
});

it("lists the current Claude models with all four prices, and says where they were read", () => {
  process.env.FACTOR_HOME = flowRepo({ lanes: [agentLane("build")] }).home; // no prices.json of a person's is read
  const claude = Object.entries(readPrices()).filter(([model]) => model.startsWith("claude-"));
  expect(claude.length).toBeGreaterThanOrEqual(8);
  for (const [model, price] of claude) {
    expect(price.cacheRead, model).toBeGreaterThan(0);
    expect(price.cacheRead, model).toBeLessThan(price.input);
    expect(price.cacheWrite, model).toBeGreaterThan(price.input);
    expect(price.output, model).toBeGreaterThan(price.input);
  }
  expect(readFileSync("src/core/prices.ts", "utf8")).toMatch(/claude-api.*\d{4}-\d{2}-\d{2}/);
});

it.each(["claude-sonnet-5-5", "claude-sonnet-5-5[1m]", "claude-sonnet-5-5-20260930"])(
  "prices a session of %s from the list when the CLI printed no cost",
  (model) => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    process.env.FACTOR_HOME = repo.home;
    const price = readPrices()["claude-sonnet-5-5"];
    printingAccount(repo, "claude", [printed(model)]);
    repo.sf("run");
    const [row] = repo.rows<{ usd: number; usd_source: string }>("select usd, usd_source from sessions");
    expect(row?.usd_source).toBe("priced");
    const by = (tokens: number, dollars = 0) => (tokens * dollars) / 1_000_000;
    expect(row?.usd).toBeCloseTo(
      by(1000, price?.input) +
        by(200, price?.output) +
        by(5000, price?.cacheRead) +
        by(300, price?.cacheWrite),
      9,
    );
    expect(row?.usd).toBeGreaterThan(0);
  },
);

it("does not guess a price for a name that is no model's", () => {
  const repo = flowRepo({ lanes: [agentLane("build")] });
  printingAccount(repo, "claude", [printed("sonnet")]);
  repo.sf("run");
  expect(repo.rows("select usd, usd_source from sessions")).toEqual([{ usd: null, usd_source: "unknown" }]);
});
