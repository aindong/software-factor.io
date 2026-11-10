// What every gate is given, and the small helpers they share.
import { execFileSync } from "node:child_process";
import { saveEvidence } from "../evidence.ts";
import { type Control, hostEnv } from "../exec.ts";
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
  /** Lets the run cancel the gate's command, and records it for recovery after a crash. */
  control: Control;
  /** Things measured once per run and kept in its state, such as the base commit's test count. */
  memo: Record<string, number | null>;
}

export const evidenceName = (g: GateJob, suffix = "") =>
  `${g.tag}-${g.gateId}${suffix}${g.attempt > 1 ? `.${g.attempt}` : ""}.log`;

export interface Changed {
  /** A added, M changed, D deleted, T type changed (a file became a link, for example). */
  status: string;
  path: string;
  oldMode: string;
  newMode: string;
  /** The content ids before and after, to tell a rename from a new file. */
  oldBlob: string;
  newBlob: string;
}

/** Files that differ between the base and the head. Read with -z, so no path is quoted or cut. */
export function changedFiles(g: GateJob): Changed[] {
  const raw = execFileSync("git", ["diff", "--raw", "--no-renames", "--no-abbrev", "-z", g.base, g.head], {
    cwd: g.ws.root,
    encoding: "utf8",
    env: hostEnv(),
    maxBuffer: 64 * 1024 * 1024,
  });
  const parts = raw.split("\0");
  const out: Changed[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [oldMode = "", newMode = "", oldBlob = "", newBlob = "", status = "M"] = (parts[i] ?? "")
      .replace(/^:/, "")
      .split(" ");
    out.push({ status: status.charAt(0), path: parts[i + 1] ?? "", oldMode, newMode, oldBlob, newBlob });
  }
  return out;
}

/** A file's text at a commit, or nothing when it is not there. */
export function fileAt(g: GateJob, commit: string, path: string): string | undefined {
  try {
    return git(g.ws.root, "show", `${commit}:${path}`);
  } catch {
    return undefined;
  }
}

/** The record of a gate, with its verdict and details saved as evidence. */
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
