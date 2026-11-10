// core/file@1: tasks from a markdown checklist in the workspace. An open box is a task, and the
// indented lines under it are its body. The factory reads the file and never edits it.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { TaskDraft } from "./index.ts";

/** A readable key that is still unique per title: "C++ build" and "C# build" must not collide. */
function keyOf(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "task"}-${createHash("sha256").update(title).digest("hex").slice(0, 6)}`;
}

export function collectFile(root: string, settings: { path: string }): TaskDraft[] {
  const file = join(root, settings.path);
  if (!existsSync(file)) return [];
  const drafts: TaskDraft[] = [];
  let current: TaskDraft | undefined;
  let fenced = false;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      current = undefined;
      continue;
    }
    if (fenced) continue;
    const box = /^- \[( |x|X)\] (.+)$/.exec(line);
    if (box) {
      const title = (box[2] ?? "").trim();
      current = box[1] === " " ? { key: keyOf(title), title, body: "" } : undefined;
      if (current) drafts.push(current);
    } else if (current && /^\s{2,}\S/.test(line)) {
      current.body += `${current.body ? "\n" : ""}${line.trim()}`;
    } else if (line.trim() !== "") {
      current = undefined;
    }
  }
  return drafts;
}
