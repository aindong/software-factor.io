// Evidence is a stored object, not a sentence (ADR 0006): a file under the run's folder and its hash.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Workspace } from "./workspace.ts";

export interface Evidence {
  /** Relative to the workspace root, so the record stays valid if the repository moves. */
  path: string;
  sha256: string;
}

export function saveEvidence(ws: Workspace, runId: string, name: string, content: string): Evidence {
  const dir = join(ws.runsDir, runId, "evidence");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, content);
  return { path: relative(ws.root, file), sha256: createHash("sha256").update(content).digest("hex") };
}
