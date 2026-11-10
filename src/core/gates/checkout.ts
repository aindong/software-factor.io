// Fresh checkouts for the gates of one lane attempt. A gate never runs in an agent's worktree
// (ADR 0005). Each checkout gets the workspace's setup command once, so gates find the project
// installed, and is removed when the attempt's gates are done.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { MINUTE_MS } from "../clock.ts";
import { saveEvidence } from "../evidence.ts";
import { type Control, hostEnv, sh } from "../exec.ts";
import { addCheckout, removeWorktree, treeOf } from "../git.ts";
import type { GateRecord } from "../store.ts";
import type { Workspace } from "../workspace.ts";

const SETUP_MINUTES = 15;

/** The workspace's setup command failed in a checkout. The record is the evidence. */
export class SetupFailed extends Error {
  record: GateRecord;
  constructor(record: GateRecord) {
    super(`setup failed (exit ${record.exit_code})`);
    this.record = record;
  }
}

export class Checkouts {
  private made = new Map<string, string>();
  private ws: Workspace;
  private runId: string;
  private tag: string;
  private attempt: number;
  private env: Record<string, string>;
  private control: Control;

  constructor(
    ws: Workspace,
    runId: string,
    tag: string,
    attempt: number,
    env: Record<string, string>,
    control: Control = {},
  ) {
    this.ws = ws;
    this.runId = runId;
    this.tag = tag;
    this.attempt = attempt;
    this.env = env;
    this.control = control;
  }

  /** A checkout of `commit`, set up and ready. `label` keeps apart checkouts that gates change. */
  async at(commit: string, label: string): Promise<string> {
    const existing = this.made.get(label);
    if (existing) return existing;
    const path = join(this.ws.workDir, `${this.runId}-gate-${this.tag}-${this.attempt}-${label}`);
    mkdirSync(this.ws.workDir, { recursive: true });
    addCheckout(this.ws.root, path, commit);
    this.made.set(label, path);

    const setup = Object.hasOwn(this.ws.config.commands, "setup") ? this.ws.config.commands.setup : undefined;
    if (setup) {
      const result = await sh(setup, {
        cwd: path,
        env: hostEnv(this.ws.config.gateEnv, this.env),
        timeoutMs: SETUP_MINUTES * MINUTE_MS,
        ...this.control,
      });
      if (result.exitCode !== 0) {
        const tree = treeOf(this.ws.root, commit);
        const name = `${this.tag}-setup-${label}${this.attempt > 1 ? `.${this.attempt}` : ""}.log`;
        const text = `$ ${setup}\n# setup in a checkout of ${commit} (tree ${tree}), exit ${result.exitCode}\n\n${result.output}`;
        const evidence = saveEvidence(this.ws, this.runId, name, text);
        throw new SetupFailed({
          gate: "setup",
          uses: "core/command@1",
          command: setup,
          exit_code: result.exitCode,
          status: "fail",
          tree_hash: tree,
          output_path: evidence.path,
          output_sha256: evidence.sha256,
          duration_ms: result.durationMs,
          attempt: this.attempt,
        });
      }
    }
    return path;
  }

  dispose(): void {
    for (const path of this.made.values()) removeWorktree(this.ws.root, path);
    this.made.clear();
  }
}
