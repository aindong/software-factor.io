// core/command@1 as a gate: a command the host runs on a fresh checkout of exactly the commit the
// lane left, never in the agent's worktree (ADR 0005). Uncommitted files do not exist for a gate.
import { MINUTE_MS } from "../clock.ts";
import { UserError } from "../errors.ts";
import { saveEvidence } from "../evidence.ts";
import { type ExecResult, hostEnv, sh } from "../exec.ts";
import { treeOf } from "../git.ts";
import type { GateRecord } from "../store.ts";
import type { Workspace } from "../workspace.ts";
import { evidenceName, type GateJob } from "./types.ts";

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

/** Run a command in a checkout the host prepared, with the small gate environment. */
export function runIn(g: GateJob, cwd: string, command: string): Promise<ExecResult> {
  const minutes =
    typeof g.settings.timeoutMinutes === "number" ? g.settings.timeoutMinutes : DEFAULT_TIMEOUT_MINUTES;
  return sh(command, { cwd, env: hostEnv(g.ws.config.gateEnv, g.env), timeoutMs: minutes * MINUTE_MS });
}

export async function commandGate(g: GateJob): Promise<GateRecord> {
  const command = resolveCommand(g.ws, g.settings, `Gate "${g.gateId}"`);
  const checkout = await g.checkouts.at(g.head, "head");
  const result = await runIn(g, checkout, command);
  const tree = treeOf(g.ws.root, g.head);
  const header = `$ ${command}\n# gate ${g.gateId} on commit ${g.head} (tree ${tree}), exit ${result.exitCode}\n\n`;
  const evidence = saveEvidence(g.ws, g.runId, evidenceName(g), header + result.output);
  return {
    gate: g.gateId,
    uses: g.uses,
    command,
    exit_code: result.exitCode,
    status: result.exitCode === 0 ? "pass" : "fail",
    tree_hash: tree,
    output_path: evidence.path,
    output_sha256: evidence.sha256,
    duration_ms: result.durationMs,
    attempt: g.attempt,
  };
}
