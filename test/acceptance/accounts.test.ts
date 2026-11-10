import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLane, flowRepo, standinAccount } from "../helpers/repo.ts";

const lanes = () => [
  agentLane("build", { on: { pass: "review", fail: "@stop" } }),
  agentLane("review", { agent: { role: "reviewer" } }),
];

describe("accounts on this machine", () => {
  const repo = flowRepo({ lanes: lanes() });
  const profile = join(repo.home, "profiles", "main");
  mkdirSync(profile, { recursive: true });

  it("are added by naming an agent and its profile folder, and hold no secret", () => {
    const r = repo.sf("account", "add", "claude-main", "--agent", "claude", "--profile", profile);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const file = JSON.parse(readFileSync(join(repo.home, "accounts.json"), "utf8"));
    expect(file.accounts["claude-main"]).toEqual({ agent: "claude", profile });
    expect(repo.sf("account", "list").stdout).toMatch(/claude-main\s+claude\s/);
  });

  it("refuse a profile folder that does not exist, an unknown agent, and a name already taken", () => {
    const nowhere = join(repo.home, "nowhere");
    const missing = repo.sf("account", "add", "x", "--agent", "claude", "--profile", nowhere);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/does not exist/);
    expect(repo.sf("account", "add", "y", "--agent", "gemini", "--profile", profile).status).toBe(1);
    const again = repo.sf("account", "add", "claude-main", "--agent", "claude", "--profile", profile);
    expect(again.status).toBe(1);
    expect(again.stderr).toMatch(/already/);
  });

  it("are removed by name", () => {
    repo.sf("account", "add", "temp", "--agent", "codex", "--profile", profile);
    expect(repo.sf("account", "list").stdout).toMatch(/temp/);
    expect(repo.sf("account", "remove", "temp").status).toBe(0);
    expect(repo.sf("account", "list").stdout).not.toMatch(/temp/);
    expect(repo.sf("account", "remove", "temp").status).toBe(1);
  });
});

describe("roles of a workspace", () => {
  const repo = flowRepo({ lanes: lanes() });
  const path = ".factor/workflows/starter.json";
  const workflow = repo.json<{ roles: Record<string, Record<string, unknown>> }>(path);
  Object.assign(workflow.roles.reviewer ?? {}, { differentVendorFrom: ["author"] });
  repo.write(path, JSON.stringify(workflow));
  standinAccount(repo, "claude-a", "claude", {});
  standinAccount(repo, "claude-b", "claude", {});
  standinAccount(repo, "codex-a", "codex", {});

  it("are bound to an account, with a model for each tier and an effort", () => {
    const models = ["--large", "opus", "--medium", "sonnet", "--small", "haiku"];
    const r = repo.sf("role", "bind", "author", "--account", "claude-a", ...models, "--effort", "high");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const local = repo.json<{ roles: Record<string, unknown> }>(".factor/local.json");
    expect(local.roles.author).toEqual({
      account: "claude-a",
      models: { large: "opus", medium: "sonnet", small: "haiku" },
      effort: "high",
    });
    expect(local.roles.reviewer).toMatchObject({ adapter: "fake" }); // other roles are left as they were
  });

  it("refuse an account or a role that does not exist", () => {
    const noAccount = repo.sf("role", "bind", "author", "--account", "ghost");
    expect(noAccount.status).toBe(1);
    expect(noAccount.stderr).toMatch(/ghost/);
    const noRole = repo.sf("role", "bind", "ghost-role", "--account", "claude-a");
    expect(noRole.status).toBe(1);
    expect(noRole.stderr).toMatch(/ghost-role/);
  });

  it("are listed, with a flag on a role that shares a vendor with one it should differ from", () => {
    repo.write(".factor/local.json", JSON.stringify({ roles: {} }));
    expect(repo.sf("role", "list").stdout).toMatch(/author\s+not bound/);
    repo.sf("role", "bind", "author", "--account", "claude-a");
    repo.sf("role", "bind", "reviewer", "--account", "claude-b");
    const same = repo.sf("role", "list").stdout;
    expect(same).toMatch(/author\s+claude-a/);
    expect(same).toMatch(/reviewer\s+claude-b.*same vendor as author/);
    repo.sf("role", "bind", "reviewer", "--account", "codex-a");
    expect(repo.sf("role", "list").stdout).not.toMatch(/same vendor/);
  });
});
