// From the second security look at task 10: what the host's own steps after a lane can be made to do.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { agentLane, bind, flowRepo, runRow, standinAccount } from "../helpers/repo.ts";

const ok = { handoff: { outcome: "pass", summary: "ok" } };

it("the host never deletes the main repository's .git when the worktree became a link to it", () => {
  const repo = flowRepo({ lanes: [agentLane("look", { agent: { access: "read" } })] });
  standinAccount(repo, "claude-a", "claude", {
    actions: [{ sh: `w=$(pwd -P); cd .. && mv "$w" "$w.old" && ln -s '${repo.dir}' "$w"` }, ok],
  });
  bind(repo, "author", "claude-a");
  expect(repo.sf("run").status).toBe(1);
  expect(existsSync(join(repo.dir, ".git", "HEAD"))).toBe(true);
  expect(repo.git("status", "--porcelain")).toBe("");
  expect(runRow(repo)?.stop_code).toBe("git_config_changed");
});

it("the host runs no filter the agent put in the global git configuration", () => {
  const repo = flowRepo({ lanes: [agentLane("build", { agent: { access: "write" }, gates: ["verify"] })] });
  repo.env.HOME = repo.home; // a private HOME: never the real ~/.gitconfig
  standinAccount(repo, "claude-a", "claude", {
    actions: [
      { write: { path: "x.sh", content: 'printf "ref: refs/heads/main\\n" > "$GIT_DIR/HEAD"; cat\n' } },
      { write: { path: ".gitattributes", content: "evil.txt filter=x\n" } },
      { write: { path: "evil.txt", content: "x\n" } },
      { sh: `printf '[filter "x"]\\n\\tclean = sh %s/x.sh\\n' "$(pwd -P)" >> "$HOME/.gitconfig"` },
      ok,
    ],
  });
  bind(repo, "author", "claude-a");
  expect(repo.sf("run").status).toBe(1);
  expect(repo.git("ls-tree", "--name-only", "main")).not.toContain("evil.txt");
  expect(runRow(repo)?.stop_code).toBe("git_config_changed");
});

it("the run stops when the agent changed the settings of its own CLI profile", () => {
  const repo = flowRepo({ lanes: [agentLane("build")] });
  standinAccount(repo, "claude-a", "claude", {
    actions: [{ sh: `echo '{"disableAllHooks":true}' > "$CLAUDE_CONFIG_DIR/settings.json"` }, ok],
  });
  bind(repo, "author", "claude-a");
  expect(repo.sf("run").status).toBe(1);
  expect(runRow(repo)?.stop_code).toBe("git_config_changed");
});
