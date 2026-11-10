// core/file@1: tasks from a markdown checklist in the workspace. An open box is a task, and the
// indented lines under it are its body. The factory reads the file and never edits it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface TaskDraft {
  key: string;
  title: string;
  body: string;
}

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "task";

export function collectFile(root: string, settings: { path: string }): TaskDraft[] {
  const file = join(root, settings.path);
  if (!existsSync(file)) return [];
  const drafts: TaskDraft[] = [];
  let current: TaskDraft | undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const box = /^- \[( |x|X)\] (.+)$/.exec(line);
    if (box) {
      current =
        box[1] === " " ? { key: slug(box[2] ?? ""), title: (box[2] ?? "").trim(), body: "" } : undefined;
      if (current) drafts.push(current);
    } else if (current && /^\s{2,}\S/.test(line)) {
      current.body += `${current.body ? "\n" : ""}${line.trim()}`;
    } else if (line.trim() !== "") {
      current = undefined;
    }
  }
  return drafts;
}
