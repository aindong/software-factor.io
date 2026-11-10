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

/**
 * Read on 2026-11-11 from the model table of the claude-api skill (cached 2026-10-06), first-party
 * API prices in dollars per million tokens. Writing the cache costs 1.25 times the input price
 * and reading it a tenth, except where the skill names another price (Fable 5.1, Opus 5.5).
 * The Claude CLI prints its own cost, so these are used only when it printed none.
 * shortcut: a cache write is priced as one kept for 5 minutes (one kept for an hour costs 2 times the input), and Haiku 5.5 as a prompt up to 100,000 tokens. Split the rows when a session's cost is off by that.
 */
const claude = (input: number, output: number, cacheRead = input / 10): Price => ({
  input,
  output,
  cacheRead,
  cacheWrite: input * 1.25,
});
const CLAUDE: Record<string, Price> = {
  "claude-fable-5-1": claude(10, 50, 0.25),
  "claude-fable-5": claude(10, 50),
  "claude-opus-5-5": claude(4, 20, 0.2),
  "claude-opus-5": claude(5, 25),
  "claude-opus-4-8": claude(5, 25),
  "claude-opus-4-7": claude(5, 25),
  "claude-opus-4-6": claude(5, 25),
  "claude-sonnet-5-5": claude(2, 10),
  "claude-sonnet-5": claude(2, 10),
  "claude-sonnet-4-6": claude(3, 15),
  "claude-haiku-5-5": claude(0.1, 0.5),
  "claude-haiku-4-5": claude(1, 5),
};

/**
 * Read on 2026-11-10 from https://developers.openai.com/api/docs/pricing: the standard tier, in
 * dollars per million tokens, for the models the Codex CLI lists.
 * shortcut: these are the prices up to 272,000 input tokens. Past that the page lists about double. Add the long rows when a session is that large.
 */
const LIST: Record<string, Price> = {
  "gpt-6.1-sol": { input: 2, cacheRead: 0.1, output: 10 },
  "gpt-6.1-terra": { input: 1, cacheRead: 0.05, output: 5 },
  "gpt-6-sol": { input: 2, cacheRead: 0.2, output: 10 },
  "gpt-6-astra": { input: 10, cacheRead: 1, output: 50 },
  "gpt-6-luna": { input: 0.1, cacheRead: 0.01, output: 0.5 },
  "gpt-5.6-sol": { input: 4, cacheRead: 0.4, output: 20 }, // a promotional price until 2026-11-30
  "gpt-5.6-terra": { input: 2, cacheRead: 0.2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cacheRead: 0.02, output: 1.2 },
  "gpt-5.3-codex": { input: 1.75, cacheRead: 0.175, output: 14 }, // refused for a ChatGPT login on 0.167.0
  ...CLAUDE,
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
  // a CLI may print a model with its context size behind it ("claude-opus-5-5[1m]"), and a Claude
  // model with its date. The name as printed comes first, so a person's own entry is the one used.
  const plain = model?.replace(/\[\w+\]$/, "");
  const named = [model, plain, plain?.startsWith("claude-") ? plain.replace(/-\d{8}$/, "") : undefined].find(
    (name) => name !== undefined && Object.hasOwn(prices, name),
  );
  const price = named === undefined ? undefined : prices[named];
  if (!price) return undefined;
  const perToken =
    used.input * price.input +
    used.output * price.output +
    used.cacheRead * (price.cacheRead ?? price.input) +
    used.cacheWrite * (price.cacheWrite ?? price.input);
  return perToken / 1_000_000;
}
