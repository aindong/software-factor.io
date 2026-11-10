// The collectors, by the name a workflow uses for them. A collector reads one place and answers
// with the tasks it found there. It never does the work, and it never changes the place it reads.
// A plugin's collector has the same shape. One that cannot collect says why: the others go on.
import type { Db } from "../db.ts";
import type { Workflow } from "../schema/workflow.ts";
import * as store from "../store.ts";
import { oneLine } from "../text.ts";
import type { Workspace } from "../workspace.ts";
import { collectFile } from "./file.ts";
import { collectGithub } from "./github.ts";
import { collectMcp } from "./mcp.ts";
import { collectSchedule } from "./schedule.ts";

export interface TaskDraft {
  /** What makes the task itself and not another, within its collector: found again, it is not added again. */
  key: string;
  title: string;
  body: string;
  labels?: string[];
}
export interface Collected {
  tasks: TaskDraft[];
  /** Something the person should know, such as items that were skipped. */
  said?: string;
}
export interface At {
  root: string;
  workflow: Workflow;
  /** The MCP servers the person allowed a collector to start on this machine, each by the print of what it runs. */
  servers: Record<string, string>;
}
const MOST_BODY = 60_000;
/** Throws, with words for the person, when it cannot collect. */
export type Collector = (at: At, settings: never) => Collected;

export const COLLECTORS: Record<string, Collector> = {
  "core/file@1": (at, settings: { path: string }) => ({ tasks: collectFile(at.root, settings) }),
  "core/github-issues@1": collectGithub,
  "core/schedule@1": collectSchedule,
  "core/mcp-query@1": collectMcp,
};

/** Ask every collector of the workflow for tasks and queue the new ones. */
export function collectAll(ws: Workspace, db: Db): { added: number; said: string[] } {
  let added = 0;
  const said: string[] = [];
  for (const c of ws.workflow.collectors) {
    const collect = Object.hasOwn(COLLECTORS, c.uses) ? COLLECTORS[c.uses] : undefined;
    try {
      if (!collect) throw new Error(`there is no collector "${c.uses}" on this machine`);
      const at = { root: ws.root, workflow: ws.workflow, servers: ws.local.servers ?? {} };
      const found = collect(at, c.with as never);
      for (const draft of found.tasks) {
        // the words came from outside: a title is one line, a body has an end
        const task = {
          collector: c.id,
          key: oneLine(draft.key, 200),
          title: oneLine(draft.title, 300),
          body: draft.body.slice(0, MOST_BODY),
          labels: (draft.labels ?? []).slice(0, 50).map((l) => oneLine(l, 100)),
        };
        if (store.addTask(db, task)) added += 1;
      }
      if (found.said) said.push(`collector ${c.id}: ${found.said}`);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      said.push(`collector ${c.id}: could not collect: ${oneLine(why, 400)}`);
    }
  }
  return { added, said };
}
