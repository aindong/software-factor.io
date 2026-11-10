// What a million tokens cost, for CLIs that report tokens but no cost. These are list prices for
// an API key. A subscription login is not billed per token: for it, the cost is what the same
// usage would have cost on a key. `prices.json` in the factor home adds or replaces a model.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { UserError } from "./errors.ts";
import { factorHome } from "./workspace.ts";

const dollars = z.number().nonnegative();
const Price = z.strictObject({
  input: dollars,
  output: dollars,
  cacheRead: dollars.optional().meta({ description: "Cached input. Priced as input when left out." }),
  cacheWrite: dollars.optional().meta({ description: "Writing the cache. Priced as input when left out." }),
});
export type Price = z.infer<typeof Price>;
const PricesFile = z.record(z.string().min(1), Price);

/** Read on 2026-11-10 from https://developers.openai.com/api/docs/pricing, in dollars per million tokens. */
const LIST: Record<string, Price> = {
  "gpt-5.3-codex": { input: 1.75, cacheRead: 0.175, output: 14 },
  "gpt-5.2-codex": { input: 1.75, cacheRead: 0.175, output: 14 },
  "gpt-5-codex": { input: 1.25, cacheRead: 0.125, output: 10 },
};

export function readPrices(): Record<string, Price> {
  const path = join(factorHome(), "prices.json");
  if (!existsSync(path)) return LIST;
  try {
    return { ...LIST, ...PricesFile.parse(JSON.parse(readFileSync(path, "utf8"))) };
  } catch (error) {
    throw new UserError(
      `Cannot read the prices at ${path}: ${(error as Error).message.slice(0, 300)}`,
      'Write it as { "<model>": { "input": 1.75, "cacheRead": 0.175, "output": 14 } }, in dollars per million tokens.',
    );
  }
}

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** The cost of a usage on a model, or nothing when the model has no price: never a guess. */
export function priceOf(model: string | undefined, used: TokenCounts): number | undefined {
  // its own entry only: "constructor" is a name every object answers to
  const prices = readPrices();
  const price = model !== undefined && Object.hasOwn(prices, model) ? prices[model] : undefined;
  if (!price) return undefined;
  const perToken =
    used.input * price.input +
    used.output * price.output +
    used.cacheRead * (price.cacheRead ?? price.input) +
    used.cacheWrite * (price.cacheWrite ?? price.input);
  return perToken / 1_000_000;
}
