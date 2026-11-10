// core/command@1 as a gate: a command the host runs on a fresh checkout of exactly the commit the
// lane left, never in the agent's worktree (ADR 0005). Uncommitted files do not exist for a gate.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../errors.ts";
import { saveEvidence } from "../evidence.ts";
import { hostEnv, sh } from "../exec.ts";
import { addCheckout, removeWorktree, treeOf } from "../git.ts";
import type { GateRecord } from "../store.ts";
import type { Workspace } from "../workspace.ts";

const DEFAULT_TIMEOUT_MINUTES = 10;

/** The shell command behind `run` or behind a workspace command name. */
export function resolveCommand(
  ws: Workspace,
  settings: { run?: unknown; command?: unknown },
  where: string,
): string {
  if (typeof settings.run === "string") return settings.run;
  const name = String(settings.command);
  const command = Object.hasOwn(ws.config.commands, name) ? ws.config.commands[name] : undefined;
  if (!command) {
    throw new UserError(
      `${where} needs the workspace command "${name}", which .factor/factory.json does not define.`,
      `Add "${name}": "<shell command>" under "commands" in .factor/factory.json.`,
    );
  }
  return command;
}

export async function runCommandGate(args: {
  ws: Workspace;
  runId: string;
  seq: number;
  lane: string;
  gateId: string;
  uses: string;
  settings: { run?: unknown; command?: unknown; timeoutMinutes?: unknown };
  commit: string;
  env: Record<string, string>;
}): Promise<GateRecord> {
  const { ws, runId, gateId, commit } = args;
  const command = resolveCommand(ws, args.settings, `Gate "${gateId}"`);
  const checkout = join(ws.workDir, `${runId}-gate-${args.seq}-${gateId}`);
  mkdirSync(ws.workDir, { recursive: true });
  addCheckout(ws.root, checkout, commit);
  try {
    const minutes =
      typeof args.settings.timeoutMinutes === "number"
        ? args.settings.timeoutMinutes
        : DEFAULT_TIMEOUT_MINUTES;
    const result = await sh(command, {
      cwd: checkout,
      env: hostEnv(ws.config.gateEnv, args.env),
      timeoutMs: minutes * 60_000,
    });
    const tree = treeOf(ws.root, commit);
    const header = `$ ${command}\n# gate ${gateId} on commit ${commit} (tree ${tree}), exit ${result.exitCode}\n\n`;
    const evidence = saveEvidence(
      ws,
      runId,
      `${String(args.seq).padStart(2, "0")}-${args.lane}-${gateId}.log`,
      header + result.output,
    );
    return {
      gate: gateId,
      uses: args.uses,
      command,
      exit_code: result.exitCode,
      status: result.exitCode === 0 ? "pass" : "fail",
      tree_hash: tree,
      output_path: evidence.path,
      output_sha256: evidence.sha256,
      duration_ms: result.durationMs,
    };
  } finally {
    removeWorktree(ws.root, checkout);
  }
}
