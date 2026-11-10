// core/no-secrets@1: a lane's change may not add something shaped like a secret. Only lines the
// change added are looked at: a secret that was there before is not the lane's doing. What is
// found is named by its file, its line and its first characters, never in full.
import { findSecrets } from "../schema/builtins.ts";
import { changedFiles, fileAt, type GateJob, record } from "./types.ts";

const MOST_BYTES = 2_000_000;
const linesOf = (text: string) => text.split(/\r\n|[\n\r]/);

export function noSecretsGate(g: GateJob) {
  const started = Date.now();
  const found: string[] = [];
  for (const file of changedFiles(g)) {
    if (file.status === "D") continue;
    const now = fileAt(g, g.head, file.path);
    if (now === undefined || now.length > MOST_BYTES || now.includes("\0")) continue; // gone, too large to be text, or not text
    const before = new Set(linesOf(fileAt(g, g.base, file.path) ?? ""));
    linesOf(now).forEach((line, i) => {
      if (before.has(line)) return;
      for (const hit of findSecrets(line))
        found.push(`${file.path}:${i + 1}: looks like a secret (${hit.shown})`);
    });
  }
  const text =
    found.length === 0
      ? "No line this change added looks like a secret."
      : `${found.join("\n")}\n\nTake it out of the change, and out of its history: a commit keeps what a later commit removes.`;
  return record(g, found.length === 0, text, started);
}
