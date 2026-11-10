// What every gate is given, and the small helpers they share.
import { saveEvidence } from "../evidence.ts";
import { git, treeOf } from "../git.ts";
import type { GateRecord } from "../store.ts";
import type { Workspace } from "../workspace.ts";
import type { Checkouts } from "./checkout.ts";

export interface GateJob {
  ws: Workspace;
  runId: string;
  /** "<seq>-<lane>", the prefix of this lane run's files. */
  tag: string;
  /** 1 for the first check of a lane's work, higher after a repair. */
  attempt: number;
  gateId: string;
  uses: string;
  settings: Record<string, unknown>;
  /** The commit the run started from, and the commit the lane left. */
  base: string;
  head: string;
  env: Record<string, string>;
  checkouts: Checkouts;
  /** Things measured once per run and kept in its state, such as the base commit's test count. */
  memo: Record<string, number | null>;
}

export const evidenceName = (g: GateJob, suffix = "") =>
  `${g.tag}-${g.gateId}${suffix}${g.attempt > 1 ? `.${g.attempt}` : ""}.log`;

/** Files that differ between the base and the head, with how: A added, M changed, D deleted. */
export function changedFiles(g: GateJob): { status: string; path: string }[] {
  return git(g.ws.root, "diff", "--name-status", "--no-renames", g.base, g.head)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split("\t");
      return { status: status ?? "M", path: rest.join("\t") };
    });
}

/** A file's text at a commit, or nothing when it is not there. */
export function fileAt(g: GateJob, commit: string, path: string): string | undefined {
  try {
    return git(g.ws.root, "show", `${commit}:${path}`);
  } catch {
    return undefined;
  }
}

/** The record of a gate that reads git and runs no command. */
export function record(
  g: GateJob,
  passed: boolean,
  text: string,
  started: number,
  extra: Partial<GateRecord> = {},
): GateRecord {
  const tree = treeOf(g.ws.root, g.head);
  const header = `# gate ${g.gateId} (${g.uses}) on commit ${g.head} (tree ${tree}): ${passed ? "pass" : "fail"}\n\n`;
  const evidence = saveEvidence(g.ws, g.runId, evidenceName(g), header + text);
  return {
    gate: g.gateId,
    uses: g.uses,
    command: null,
    exit_code: null,
    status: passed ? "pass" : "fail",
    tree_hash: tree,
    output_path: evidence.path,
    output_sha256: evidence.sha256,
    duration_ms: Date.now() - started,
    attempt: g.attempt,
    ...extra,
  };
}
