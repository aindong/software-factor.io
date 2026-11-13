// The tasks waiting for a run, oldest first: what `softwarefactor status` lists as queued, and what
// the Floor's strip shows. A stopped run's task that was put back is one of them.
import type { Db } from "../db.ts";

export interface Queued {
  key: string;
  title: string;
}

export const listQueued = (db: Db): Queued[] =>
  db.prepare("select key, title from tasks where status = 'queued' order by id").all() as unknown as Queued[];
