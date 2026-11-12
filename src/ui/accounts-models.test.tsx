// What a role's row offers for the model of each tier, as markup: the list of the bound account's
// agent, the CLI's own, another model, and a bound model the list does not know.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AccountsView } from "../core/views.ts";
import { RoleRow } from "./Accounts.tsx";

// the row is only drawn here: nothing is sent, and the page's key is never read
vi.mock("./api.ts", () => ({ op: async () => ({ status: 200, body: {} }) }));

type Role = AccountsView["roles"][number];
const account = (name: string, agent: string, models: { value: string; label: string }[]) => ({
  name,
  agent,
  limits: [],
  headroom: 0.9,
  heldUntil: null,
  reading: null,
  models,
});
const accounts = [
  account("claude-main", "claude", [
    { value: "claude-opus-5-5", label: "Opus 5.5 (claude-opus-5-5)" },
    { value: "claude-sonnet-5-5", label: "Sonnet 5.5 (claude-sonnet-5-5)" },
    { value: "sonnet", label: "sonnet (last ran as claude-sonnet-5-5)" },
  ]),
  account("openai-main", "codex", [{ value: "gpt-6.1-sol", label: "GPT-6.1 Sol (gpt-6.1-sol)" }]),
];
const role = (works: string, models: Record<string, string>): Role => ({
  role: "author",
  description: "Writes.",
  works: { account: works, agent: accounts.find((a) => a.name === works)?.agent ?? null },
  models,
  effort: null,
  sameVendorAs: [],
});

const decode = (text: string) =>
  text
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<");
/** The options of the select with this label: what each says, and which one is chosen. */
function options(markup: string, label: string) {
  const select = new RegExp(`<select[^>]*aria-label="${label}"[^>]*>(.*?)</select>`).exec(markup);
  if (!select) throw new Error(`no select "${label}" in ${markup}`);
  return [...(select[1] ?? "").matchAll(/<option([^>]*)>(.*?)<\/option>/g)].map(
    ([, attrs = "", text = ""]) => ({
      value: decode(/value="([^"]*)"/.exec(attrs)?.[1] ?? text),
      text: decode(text),
      chosen: / selected=""/.test(attrs),
    }),
  );
}
const draw = (r: Role) =>
  renderToStaticMarkup(
    <table>
      <tbody>
        <RoleRow role={r} accounts={accounts} onBound={() => {}} />
      </tbody>
    </table>,
  );

describe("the model of each tier", () => {
  it("is chosen from the bound account's list, between the CLI's own and another model", () => {
    const medium = options(
      draw(role("claude-main", { medium: "sonnet" })),
      "Model for medium lanes of author",
    );
    expect(medium.map((o) => o.text)).toEqual([
      "the CLI's own",
      "Opus 5.5 (claude-opus-5-5)",
      "Sonnet 5.5 (claude-sonnet-5-5)",
      "sonnet (last ran as claude-sonnet-5-5)",
      "Another model",
    ]);
    expect(medium[0]?.value).toBe("");
    expect(medium.filter((o) => o.chosen).map((o) => o.value)).toEqual(["sonnet"]);
  });

  it("has the CLI's own chosen when the tier names no model", () => {
    const small = options(draw(role("claude-main", {})), "Model for small lanes of author");
    expect(small.filter((o) => o.chosen).map((o) => o.text)).toEqual(["the CLI's own"]);
  });

  it("shows and keeps a bound model the list does not know", () => {
    const large = options(
      draw(role("claude-main", { large: "claude-opus-6-preview" })),
      "Model for large lanes of author",
    );
    expect(large.filter((o) => o.chosen)).toEqual([
      { value: "claude-opus-6-preview", text: "claude-opus-6-preview", chosen: true },
    ]);
    expect(large.at(-1)?.text).toBe("Another model");
  });

  it("keeps a bound model named as the value of another model once, in its text field", () => {
    const markup = draw(role("claude-main", { medium: "+another" }));
    expect(options(markup, "Model for medium lanes of author").filter((o) => o.chosen)).toEqual([
      { value: "+another", text: "Another model", chosen: true },
    ]);
    expect(markup).toMatch(
      /<input[^>]*aria-label="Another model for medium lanes of author"[^>]*value="\+another"/,
    );
  });

  it("lists the models of a Codex account for a role bound to one", () => {
    const medium = options(draw(role("openai-main", {})), "Model for medium lanes of author");
    expect(medium.map((o) => o.text)).toEqual([
      "the CLI's own",
      "GPT-6.1 Sol (gpt-6.1-sol)",
      "Another model",
    ]);
  });

  it("keeps the account and the effort as lists of their own", () => {
    const markup = draw(role("claude-main", {}));
    expect(options(markup, "Account for the role author").map((o) => o.text)).toEqual([
      "claude-main",
      "openai-main",
    ]);
    expect(options(markup, "Effort for the role author")[0]?.text).toBe("the CLI's own");
  });
});
