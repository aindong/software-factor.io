// The scripted agent: it does exactly what its script says, with no model. Tests, the quick start
// and the evals run on it, so the engine and every gate can be proven for free (ADR 0010).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { FakeAction, RoleBinding } from "../config.ts";
import { commitAll } from "../git.ts";
import type { AgentAdapter, AgentJob } from "./types.ts";

export function fakeAgent(binding: RoleBinding): AgentAdapter {
  return {
    async run(job: AgentJob) {
      const script: FakeAction[] = binding.script?.[job.lane.id] ?? binding.script?.["*"] ?? [];
      for (const action of script) {
        if ("write" in action) {
          const target = resolve(job.cwd, action.write.path);
          if (!target.startsWith(`${job.cwd}/`))
            throw new Error(`fake agent: "${action.write.path}" is outside the worktree`);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, action.write.content);
        } else if ("delete" in action) {
          rmSync(join(job.cwd, action.delete), { force: true, recursive: true });
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
