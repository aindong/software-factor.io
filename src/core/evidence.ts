// Evidence is a stored object, not a sentence (ADR 0006): a file under the run's folder and its hash.
// Only the host writes here. A file is created once and never written through a link.
import { createHash } from "node:crypto";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Workspace } from "./workspace.ts";

export interface Evidence {
  /** Relative to the workspace root, so the record stays valid if the repository moves. */
  path: string;
  sha256: string;
}

/** Write a file the host owns under the run's folder. Refuses a path that resolves outside the workspace. */
export function saveRunFile(
  ws: Pick<Workspace, "root" | "runsDir">,
  runId: string,
  folder: string,
  name: string,
  content: string | Buffer,
): Evidence {
  const dir = join(ws.runsDir, runId, folder);
  mkdirSync(dir, { recursive: true });
  if (!realpathSync(dir).startsWith(`${realpathSync(ws.root)}${sep}`)) {
    throw new Error(`refusing to write run files through a link at ${dir}`);
  }
  const file = join(dir, name);
  writeFileSync(file, content, { flag: "wx" }); // "wx": fail if anything, a symlink included, is already there
  return { path: relative(ws.root, file), sha256: createHash("sha256").update(content).digest("hex") };
}

export const saveEvidence = (
  ws: Pick<Workspace, "root" | "runsDir">,
  runId: string,
  name: string,
  content: string | Buffer,
) => saveRunFile(ws, runId, "evidence", name, content);
