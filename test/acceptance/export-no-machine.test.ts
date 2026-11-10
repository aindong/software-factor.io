// An export holds nothing of the machine it came from.
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { exported, source } from "../helpers/sharing.ts";

it("holds no account, no path of this machine, no command line of the workspace, nothing of local.json", () => {
  const repo = source();
  const profile = mkdtempSync(join(tmpdir(), "sf-profile-"));
  expect(repo.sf("account", "add", "claude-at-work", "--agent", "claude", "--profile", profile).status).toBe(
    0,
  );
  expect(repo.sf("role", "bind", "reviewer", "--account", "claude-at-work").status).toBe(0);
  const factory = repo.json<Record<string, unknown>>(".factor/factory.json");
  repo.write(
    ".factor/factory.json",
    JSON.stringify({ ...factory, gateEnv: ["DEPLOY_TOKEN_NAME_OF_THIS_REPO"] }),
  );
  repo.env.DEPLOY_TOKEN_NAME_OF_THIS_REPO = "a-value-never-to-be-seen";

  const { text, status, stderr } = exported(repo);
  expect(status, stderr).toBe(0);
  for (const never of [
    "claude-at-work",
    profile,
    homedir(),
    repo.dir,
    repo.home,
    "THE-VERIFY-LINE-OF-THIS-REPO",
    "DEPLOY_TOKEN_NAME_OF_THIS_REPO",
    "a-value-never-to-be-seen",
    '"adapter"',
    '"script"',
    "local.json",
  ])
    expect(text, never).not.toContain(never);
});
