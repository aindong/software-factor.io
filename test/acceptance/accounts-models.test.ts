// The models a role can be bound to: the accounts view lists each account's, the session record
// says which model a lane asked for, and `role list` prints the model of each tier.
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { op, tool } from "../helpers/operator.ts";
import { agentLane, bind, flowRepo, standinAccount, startUi, type Ui } from "../helpers/repo.ts";

interface Choice {
  value: string;
  label: string;
}
interface View {
  accounts: { name: string; agent: string; models: Choice[] }[];
}

const repo = flowRepo({ lanes: [agentLane("build")] });
standinAccount(repo, "claude-main", "claude", {
  modelName: "claude-sonnet-5-5",
  actions: [{ handoff: { outcome: "pass", summary: "ok" } }],
});
standinAccount(repo, "openai-main", "codex", {});
if (repo.sf("account", "add", "script", "--agent", "command", "--command", "true").status !== 0) {
  throw new Error("account add failed");
}
// the lane is of the medium tier: it asks for the alias, and the CLI says which version worked
bind(repo, "author", "claude-main", "--medium", "sonnet", "--large", "claude-opus-5-5", "--effort", "high");
const run = repo.sf("run");
const accountOf = (view: View, name: string) => view.accounts.find((a) => a.name === name);

describe("the session record", () => {
  it("keeps the model the lane asked for beside the one the CLI says worked", () => {
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(repo.rows("select account, asked_model, model from sessions")).toEqual([
      { account: "claude-main", asked_model: "sonnet", model: "claude-sonnet-5-5" },
    ]);
  });
});

describe("the models of each account", () => {
  const view = () => {
    const answer = tool<View>(repo, "accounts_list");
    if (answer.refused) throw new Error(answer.text);
    return answer.data;
  };

  it("lists a Claude Code account's models, newest first, and the alias with the version it last ran as", () => {
    const models = accountOf(view(), "claude-main")?.models ?? [];
    expect(models.slice(0, 4)).toEqual([
      { value: "claude-opus-5-5", label: "Opus 5.5 (claude-opus-5-5)" },
      { value: "claude-sonnet-5-5", label: "Sonnet 5.5 (claude-sonnet-5-5)" },
      { value: "claude-haiku-5-5", label: "Haiku 5.5 (claude-haiku-5-5)" },
      { value: "claude-fable-5-1", label: "Fable 5.1 (claude-fable-5-1)" },
    ]);
    expect(models).toContainEqual({ value: "sonnet", label: "sonnet (last ran as claude-sonnet-5-5)" });
    expect(models.filter((m) => m.value.startsWith("gpt-"))).toEqual([]);
  });

  it("lists a Codex account's models only, with nothing another account ran", () => {
    const models = accountOf(view(), "openai-main")?.models ?? [];
    expect(models[0]).toEqual({ value: "gpt-6.1-sol", label: "GPT-6.1 Sol (gpt-6.1-sol)" });
    expect(models.map((m) => m.value)).not.toContain("sonnet");
    expect(models.filter((m) => m.value.startsWith("claude-"))).toEqual([]);
  });

  it("lists no model for an account whose agent the product knows none of", () => {
    expect(accountOf(view(), "script")?.models).toEqual([]);
  });
});

describe("role list", () => {
  it("prints the model of each tier and the effort, as the page shows them", () => {
    const list = repo.sf("role", "list");
    expect(list.status).toBe(0);
    const author = list.stdout.split("\n").find((l) => l.startsWith("author"));
    expect(author).toContain("claude-main (claude)");
    expect(author).toContain("small the CLI's own, medium sonnet, large claude-opus-5-5, effort high");
    // a role worked by the scripted agent has no model to print
    const reviewer = list.stdout.split("\n").find((l) => l.startsWith("reviewer"));
    expect(reviewer).toContain("the scripted agent");
    expect(reviewer).not.toContain("medium");
  });
});

describe("sessions that finish out of order", () => {
  it("say the version of the session that started last, not the one recorded last", () => {
    // a session that started before the run's own but finished, and was recorded, after it
    const db = new DatabaseSync(join(repo.dir, ".factor/state.db"));
    try {
      db.exec(`insert into sessions (run_id, lane_run_id, lane, try, account, agent, model, asked_model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tokens, usd_source,
        started_at, duration_ms)
        select run_id, lane_run_id, lane, try, account, agent, 'claude-sonnet-5', asked_model,
        0, 0, 0, 0, 0, usd_source, '2000-01-01T00:00:00.000Z', 0 from sessions`);
    } finally {
      db.close();
    }
    const answer = tool<View>(repo, "accounts_list");
    if (answer.refused) throw new Error(answer.text);
    expect(accountOf(answer.data, "claude-main")?.models).toContainEqual({
      value: "sonnet",
      label: "sonnet (last ran as claude-sonnet-5-5)",
    });
  });
});

describe("binding from the page", () => {
  let ui: Ui;
  beforeAll(async () => {
    ui = await startUi(repo);
  }, 120_000);
  afterAll(() => ui?.stop());

  it("keeps the rest of .factor/local.json", async () => {
    const local = repo.json<Record<string, unknown> & { roles: Record<string, unknown> }>(
      ".factor/local.json",
    );
    repo.write(
      ".factor/local.json",
      `${JSON.stringify({ ...local, servers: { tracker: "a1b2c3" } }, null, 2)}\n`,
    );
    const bound = await op(ui, "roles_bind", {
      role: "author",
      account: "openai-main",
      medium: "gpt-6.1-sol",
    });
    expect(bound.status, JSON.stringify(bound.body)).toBe(200);
    const after = repo.json<Record<string, unknown> & { roles: Record<string, unknown> }>(
      ".factor/local.json",
    );
    expect(after.servers).toEqual({ tracker: "a1b2c3" });
    expect(after.roles.reviewer).toEqual(local.roles.reviewer);
    expect(after.roles.author).toEqual({ account: "openai-main", models: { medium: "gpt-6.1-sol" } });
    expect(repo.sf("role", "list").stdout).toContain(
      "small the CLI's own, medium gpt-6.1-sol, large the CLI's own",
    );
  });
});
