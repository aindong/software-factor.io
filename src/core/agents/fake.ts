// The scripted agent: it does exactly what its script says, with no model. Tests, the quick start
// and the evals run on it, so the engine and every gate can be proven for free (ADR 0010).
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import type { FakeAction, RoleBinding } from "../config.ts";
import { commitAll } from "../git.ts";
import type { AgentAdapter, AgentJob } from "./types.ts";

/**
 * The full path of `rel` in the worktree. Refused when it leaves the worktree, directly or through a
 * symlink in a folder on the way. With `through`, also refused when the path itself is a link out.
 */
function inside(cwd: string, rel: string, through: boolean): string {
  const root = realpathSync(cwd);
  const within = (p: string) => p === root || p.startsWith(`${root}${sep}`);
  const target = resolve(root, rel);
  let folder = dirname(target);
  while (!existsSync(folder)) folder = dirname(folder);
  const linkOut =
    through && existsSync(target) && lstatSync(target).isSymbolicLink() && !within(realpathSync(target));
  if (target === root || !within(target) || !within(realpathSync(folder)) || linkOut) {
    throw new Error(`fake agent: "${rel}" is outside the worktree`);
  }
  return target;
}

export function fakeAgent(binding: RoleBinding): AgentAdapter {
  return {
    async run(job: AgentJob) {
      const script: FakeAction[] = binding.script?.[job.lane.id] ?? binding.script?.["*"] ?? [];
      for (const action of script) {
        if ("write" in action) {
          const target = inside(job.cwd, action.write.path, true);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, action.write.content);
        } else if ("delete" in action) {
          rmSync(inside(job.cwd, action.delete, false), { force: true, recursive: true });
        } else if ("commit" in action) {
          commitAll(job.cwd, action.commit);
        } else if ("handoff" in action) {
          writeFileSync(job.handoffPath, `${JSON.stringify(action.handoff, null, 2)}\n`);
        } else if ("exit" in action) {
          return { exitCode: action.exit };
        }
      }
      return { exitCode: 0 };
    },
  };
}
