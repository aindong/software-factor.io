// The few git operations the factory needs. Each run works in its own worktree and its own branch.
// An agent can write under the shared .git folder, so the host never lets git run a hook or a
// file-system monitor from it, and gives git only the small host environment.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { UserError } from "./errors.ts";
import { hostEnv } from "./exec.ts";

const SAFE = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];

export function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync("git", [...SAFE, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: hostEnv(),
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${stderr || (error as Error).message}`);
  }
}

/** The top folder of the repository that contains `cwd`. */
export function repoRoot(cwd: string): string {
  try {
    return git(cwd, "rev-parse", "--show-toplevel");
  } catch {
    throw new UserError(
      "This folder is not inside a git repository.",
      "Run `git init` and make a first commit, then try again.",
    );
  }
}

/** The branch the repository is on, which runs branch from and must not be pushed to. */
export function currentBranch(root: string): string {
  try {
    return git(root, "symbolic-ref", "--short", "-q", "HEAD");
  } catch {
    return "main"; // not on a branch
  }
}
export const headOf = (cwd: string) => git(cwd, "rev-parse", "--verify", "HEAD^{commit}");
export const treeOf = (cwd: string, commit: string) => git(cwd, "rev-parse", `${commit}^{tree}`);

/** The commit a branch points at, read from the repository itself and not from any worktree. */
export const branchTip = (root: string, branch: string) =>
  git(root, "rev-parse", "--verify", `refs/heads/${branch}^{commit}`);

/** A new branch from `base`, checked out in its own folder. */
export function addWorktree(root: string, path: string, branch: string, base: string): void {
  git(root, "worktree", "add", "-q", "-b", branch, path, base);
}

/** A checkout of exactly `commit` with nothing else in it, for a gate. */
export function addCheckout(root: string, path: string, commit: string): void {
  git(root, "worktree", "add", "-q", "--detach", path, commit);
}

export function removeWorktree(root: string, path: string): void {
  try {
    git(root, "worktree", "remove", "--force", path);
  } catch {
    // a leftover folder is cleaned up by `git worktree prune` and must not fail a run
  }
}

/** The git folder of a run's worktree, as the repository itself names it. */
export function worktreeGitDir(root: string, worktree: string): string {
  return join(resolve(root, git(root, "rev-parse", "--git-common-dir")), "worktrees", basename(worktree));
}

/**
 * Git on a run's worktree, for the host. An agent can rewrite the worktree's `.git` file to point
 * git somewhere else, so the host names the git folder and the work tree itself: both beat the file
 * and any `core.worktree` setting.
 */
export function worktreeGit(root: string, worktree: string): (...args: string[]) => string {
  const gitDir = worktreeGitDir(root, worktree);
  return (...args) => git(worktree, `--git-dir=${gitDir}`, `--work-tree=${worktree}`, ...args);
}

/** The branches an agent must not push to: the one the repository is on, and the remote's default. */
export function protectedBranches(root: string): string[] {
  const names = [currentBranch(root)];
  try {
    names.push(
      git(root, "symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD").replace(/^origin\//, ""),
    );
  } catch {
    // no remote, or it names no default
  }
  return [...new Set(names)];
}

/** Commit everything in `cwd`. Returns false when there was nothing to commit. */
export function commitAll(
  cwd: string,
  message: string,
  run: (...args: string[]) => string = (...args) => git(cwd, ...args),
): boolean {
  run("add", "-A");
  if (run("status", "--porcelain") === "") return false;
  run(
    "-c",
    "user.name=Software Factor.io",
    "-c",
    "user.email=factor@localhost",
    "commit",
    "-q",
    "-m",
    message,
  );
  return true;
}

/**
 * A hash of the repository's git configuration and hooks. If it changes while an agent works, the
 * agent has altered what git will run later, for the host or for the developer, and the run stops.
 */
export function gitConfigFingerprint(root: string): string {
  const gitDir = resolve(root, git(root, "rev-parse", "--git-common-dir"));
  const hash = createHash("sha256");
  for (const name of ["config", "config.worktree", "info/attributes"]) {
    const file = join(gitDir, name);
    hash.update(`${name}\0${existsSync(file) ? readFileSync(file, "utf8") : ""}\0`);
  }
  const hooks = join(gitDir, "hooks");
  for (const name of existsSync(hooks) ? readdirSync(hooks).sort() : []) {
    const file = join(hooks, name);
    if (statSync(file).isFile()) hash.update(`${name}\0${readFileSync(file).toString("base64")}\0`);
  }
  return hash.digest("hex");
}
