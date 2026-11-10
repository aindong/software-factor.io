// After a real agent has worked, the host puts the run's worktree in order itself. The worktree is
// the agent's to write, including its `.git` file and its HEAD, so nothing there is trusted: git is
// told which git folder to use, and nothing is reset, cleaned or committed unless the worktree is
// still on the run's own branch.
import { existsSync, lstatSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { branchTip, commitAll, git, worktreeGit, worktreeGitDir } from "../git.ts";
import type { Lane } from "../schema/workflow.ts";
import type { Run } from "../store.ts";
import type { Workspace } from "../workspace.ts";

export interface Settled {
  /** Why the lane fails, when the tree was not as it must be. */
  fail?: string;
  /** The run must stop: what git will do in this worktree was changed. */
  stop?: boolean;
}

/** True when the worktree's `.git` is still the plain file that names its own git folder. Puts it back when not. */
function gitFileIntact(root: string, worktree: string): boolean {
  const file = join(worktree, ".git");
  const gitDir = worktreeGitDir(root, worktree);
  try {
    if (lstatSync(file).isFile()) {
      const named = /^gitdir: (.+)$/m.exec(readFileSync(file, "utf8"))?.[1]?.trim() ?? "";
      // the git folder must also still lead to this repository's shared folder, not to one the agent made
      const common = resolve(gitDir, readFileSync(join(gitDir, "commondir"), "utf8").trim());
      const leadsHome = realpathSync(common) === realpathSync(resolve(gitDir, "../.."));
      if (leadsHome && existsSync(named) && realpathSync(named) === realpathSync(gitDir)) return true;
    }
  } catch {
    // missing or unreadable: not intact
  }
  try {
    rmSync(file, { force: true }); // never with what is below it: a folder here is not the host's to delete
    writeFileSync(file, `gitdir: ${gitDir}\n`);
  } catch {
    // it stays as it is, and the run stops
  }
  return false;
}

export function settleTree(
  ws: Workspace,
  run: Run,
  lane: Lane,
  before: { tip: string; path: string },
  message: string,
  log: string[],
): Settled {
  const tipBefore = before.tip;
  const readOnly = lane.agent?.access !== "write";
  const moved = () => branchTip(ws.root, run.branch) !== tipBefore;
  /** A lane that only reads may not leave a commit: the run's branch goes back to where it was. */
  const putBack = () => {
    if (readOnly && moved()) git(ws.root, "update-ref", `refs/heads/${run.branch}`, tipBefore);
  };
  try {
    // a worktree that was moved, or swapped for a link, is somewhere else now: nothing is done there
    let inPlace = false;
    try {
      inPlace = !lstatSync(run.worktree).isSymbolicLink() && realpathSync(run.worktree) === before.path;
    } catch {
      // gone
    }
    if (!inPlace) {
      putBack();
      return { stop: true, fail: `the run's worktree was moved or replaced while lane "${lane.id}" worked` };
    }
    if (!gitFileIntact(ws.root, run.worktree)) {
      putBack();
      return { stop: true, fail: `the worktree's .git file was changed while lane "${lane.id}" worked` };
    }
    const tree = worktreeGit(ws.root, run.worktree);
    let head = "";
    try {
      head = tree("symbolic-ref", "-q", "HEAD");
    } catch {
      // not on a branch
    }
    if (head !== `refs/heads/${run.branch}`) {
      putBack();
      return { fail: "the worktree is no longer on the run's branch, so the host left its files alone" };
    }
    if (!readOnly) {
      // an agent in a sandbox cannot reach git's folder, and any agent can forget: what it left
      // uncommitted is committed here, so the gates judge all of its work
      commitAll(run.worktree, message, tree);
      return {};
    }
    // A lane that only reads leaves nothing behind. A commit or a changed file means its verdict
    // is about code it altered itself, so the lane fails. A scratch file is only removed.
    const changed = tree("status", "--porcelain", "--untracked-files=no") !== "" || moved();
    const scratch = !changed && tree("status", "--porcelain") !== "";
    if (changed) tree("reset", "--hard", "-q", tipBefore);
    tree("clean", "-fdq");
    if (changed) {
      return {
        fail: `lane "${lane.id}" only reads, and its agent changed the repository: the change was dropped`,
      };
    }
    if (scratch) log.push(`  ${lane.id}: this lane only reads: files its agent left were removed`);
    return {};
  } catch (error) {
    return { fail: `the host could not put the worktree in order: ${(error as Error).message}` };
  }
}
