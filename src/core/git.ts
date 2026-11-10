// The few git operations the factory needs. Each run works in its own worktree and its own branch.
import { execFileSync } from "node:child_process";
import { UserError } from "./errors.ts";

export function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${stderr || (error as Error).message}`);
  }
}

/** The top folder of the repository that contains `cwd`. */
export function repoRoot(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new UserError(
      "This folder is not inside a git repository.",
      "Run `git init` and make a first commit, then try again.",
    );
  }
}

export const headOf = (cwd: string) => git(cwd, "rev-parse", "HEAD");
export const treeOf = (cwd: string, commit: string) => git(cwd, "rev-parse", `${commit}^{tree}`);

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

/** Commit everything in `cwd`. Returns false when there was nothing to commit. */
export function commitAll(cwd: string, message: string): boolean {
  git(cwd, "add", "-A");
  if (git(cwd, "status", "--porcelain") === "") return false;
  git(
    cwd,
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
