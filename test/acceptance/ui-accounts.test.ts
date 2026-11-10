import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { op, tool } from "../helpers/operator.ts";
import {
  agentLane,
  bind,
  editWorkflow,
  flowRepo,
  standinAccount,
  startUi,
  type Ui,
} from "../helpers/repo.ts";

interface Accounts {
  accounts: {
    name: string;
    agent: string;
    limits: { hours: number; tokens: number; used: number }[];
    headroom: number;
    heldUntil: string | null;
  }[];
  roles: {
    role: string;
    description: string;
    works: { account: string; agent: string | null } | "scripted" | null;
    models: Record<string, string>;
    effort: string | null;
    sameVendorAs: string[];
  }[];
}
const repo = flowRepo({
  lanes: [
    agentLane("build", { on: { pass: "review", fail: "@stop" } }),
    agentLane("review", { agent: { role: "reviewer" } }),
  ],
});
editWorkflow(repo, (w) => {
  (w.roles as Record<string, Record<string, unknown>>).reviewer = {
    description: "Reads.",
    differentVendorFrom: ["author"],
  };
});
repo.git("commit", "-qam", "the reviewer is on another vendor");
standinAccount(repo, "work", "claude", {}, [
  "--limit",
  "5h=1000",
  "--limit",
  "168h=50000",
  "--headroom",
  "0.8",
]);
standinAccount(repo, "spare", "claude", {});
standinAccount(repo, "other", "codex", {});
bind(repo, "author", "work", "--medium", "sonnet", "--effort", "high");
const usage = join(repo.home, "usage.jsonl");
appendFileSync(usage, `${JSON.stringify({ at: Date.now() - 60_000, account: "work", tokens: 400 })}\n`);
appendFileSync(
  usage,
  `${JSON.stringify({ at: Date.now() - 6 * 3_600_000, account: "work", tokens: 300 })}\n`,
);
appendFileSync(
  usage,
  `${JSON.stringify({ at: Date.now(), account: "other", holdUntil: Date.now() + 3_600_000 })}\n`,
);
const local = () => repo.json<{ roles: Record<string, unknown> }>(".factor/local.json").roles;
let ui: Ui;
beforeAll(async () => {
  ui = await startUi(repo);
}, 120_000);
afterAll(() => ui?.stop());
const view = async () => (await op<Accounts>(ui, "accounts_list")).body;

describe("accounts and roles", () => {
  it("shows each account with its limits, what it used in each window, and a hold", async () => {
    const { accounts } = await view();
    expect(accounts.map((a) => `${a.name}:${a.agent}`)).toEqual([
      "work:claude",
      "spare:claude",
      "other:codex",
    ]);
    expect(accounts[0]).toMatchObject({
      limits: [
        { hours: 5, tokens: 1000, used: 400 },
        { hours: 168, tokens: 50000, used: 700 },
      ],
      headroom: 0.8,
      heldUntil: null,
    });
    expect(accounts[1]?.limits).toEqual([]);
    expect(Date.parse(accounts[2]?.heldUntil ?? "")).toBeGreaterThan(Date.now() + 3_000_000);
  });

  it("shows what works each role", async () => {
    const { roles } = await view();
    expect(roles).toMatchObject([
      {
        role: "author",
        description: "Writes.",
        works: { account: "work", agent: "claude" },
        models: { medium: "sonnet" },
        effort: "high",
        sameVendorAs: [],
      },
      { role: "reviewer", works: "scripted", sameVendorAs: [] },
    ]);
  });

  it("tells nothing of where a login is kept", async () => {
    const text = JSON.stringify(await view());
    expect(text).not.toContain(repo.home);
    expect(text).not.toMatch(/profile|"bin"|standin/);
    expect(tool(repo, "accounts_list").text).not.toContain(repo.home);
  });

  it("binds a role as the command line does, and flags a vendor a role must differ from", async () => {
    const bound = await op(ui, "roles_bind", {
      role: "reviewer",
      account: "spare",
      effort: "low",
      large: "opus",
    });
    expect(bound.status, JSON.stringify(bound.body)).toBe(200);
    expect(local().reviewer).toEqual({ account: "spare", models: { large: "opus" }, effort: "low" });
    expect(local().author).toEqual({ account: "work", models: { medium: "sonnet" }, effort: "high" });
    expect((await view()).roles[1]).toMatchObject({
      works: { account: "spare", agent: "claude" },
      sameVendorAs: ["author"],
    });
    // through the MCP server, to the other vendor
    expect(tool(repo, "roles_bind", { role: "reviewer", account: "other" }).refused).toBe(false);
    expect(local().reviewer).toEqual({ account: "other" });
    expect((await view()).roles[1]).toMatchObject({
      works: { account: "other", agent: "codex" },
      sameVendorAs: [],
    });
  });

  it("refuses a binding the command line refuses, in its words, and writes nothing", async () => {
    const before = repo.read(".factor/local.json");
    const refused: [unknown, RegExp][] = [
      [{ role: "nobody", account: "work" }, /has no role "nobody"/],
      [{ role: "author", account: "ghost" }, /There is no account "ghost"/],
      [{ role: "author", account: "work", effort: "extreme" }, /not valid/],
      [{ role: "constructor", account: "work" }, /has no role/],
    ];
    for (const [input, words] of refused) {
      const api = await op(ui, "roles_bind", input);
      expect(api.status, JSON.stringify(input)).toBe(409);
      expect(api.body.error).toMatch(words);
      expect(tool(repo, "roles_bind", input).text).toMatch(words);
    }
    for (const input of [
      { role: "author", account: "__proto__" },
      { role: "--account", account: "work" },
      { role: "author", account: "work", medium: "--effort" },
    ]) {
      expect((await op(ui, "roles_bind", input)).status, JSON.stringify(input)).toBe(422);
    }
    expect(repo.read(".factor/local.json")).toBe(before);
  });
});
