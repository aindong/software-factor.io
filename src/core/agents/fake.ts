// The scripted agent: it does exactly what its script says, with no model. Tests, the quick start
// and the evals run on it, so the engine and every gate can be proven for free (ADR 0010).
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { FakeAction, FakeBinding } from "../config.ts";
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

/** Pretend to work, but stop the moment the engine says the time is up. */
const nap = (ms: number, signal: AbortSignal) =>
  new Promise<void>((done) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      done();
    });
  });

export function fakeAgent(binding: FakeBinding): AgentAdapter {
  return {
    async run(job: AgentJob) {
      const scripted = binding.script?.[job.lane.id] ?? binding.script?.["*"] ?? [];
      // a list of lists is one script per entry to the lane, the last one repeating
      const perEntry = scripted.every((s) => Array.isArray(s)) && scripted.length > 0;
      const script = (
        perEntry ? scripted[Math.min(job.entry, scripted.length - 1)] : scripted
      ) as FakeAction[];
      const usage = { tokens: 0, usd: 0 };
      for (const action of script) {
        if (job.signal.aborted) return { exitCode: 124, usage };
        if ("write" in action) {
          const target = inside(job.cwd, action.write.path, true);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, action.write.content, { mode: action.write.executable ? 0o755 : 0o644 });
        } else if ("delete" in action) {
          rmSync(inside(job.cwd, action.delete, false), { force: true, recursive: true });
        } else if ("commit" in action) {
          commitAll(job.cwd, action.commit);
        } else if ("handoff" in action) {
          writeFileSync(job.handoffPath, `${JSON.stringify(action.handoff, null, 2)}\n`);
        } else if ("attach" in action) {
          if (/[\\/]/.test(action.attach.name) || action.attach.name.startsWith(".")) {
            throw new Error(`fake agent: "${action.attach.name}" is not a plain file name`);
          }
          mkdirSync(job.evidenceDir, { recursive: true });
          writeFileSync(join(job.evidenceDir, action.attach.name), action.attach.content);
        } else if ("sleep" in action) {
          await nap(action.sleep, job.signal);
        } else if ("usage" in action) {
          usage.tokens += action.usage.tokens;
          usage.usd += action.usage.usd ?? 0;
        } else if ("exit" in action) {
          return { exitCode: action.exit, usage };
        }
      }
      return { exitCode: job.signal.aborted ? 124 : 0, usage };
    },
  };
}
