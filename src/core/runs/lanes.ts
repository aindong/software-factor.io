// The lanes of a workflow as a run's page names them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drawable } from "../floor/layout.ts";

export type LaneDef = { id: string; name?: string; uses?: string; gates?: string[]; panel?: unknown };
const NAME = /^[a-z][a-z0-9-]*$/;

/** Reads each workflow's lanes once, as far as they can be read. */
export function laneReader(root: string): (workflow: string) => LaneDef[] {
  const known = new Map<string, LaneDef[]>();
  return (workflow) => {
    let lanes = known.get(workflow);
    if (!lanes) {
      lanes = [];
      try {
        const file = join(root, ".factor", "workflows", `${workflow}.json`);
        if (NAME.test(workflow))
          lanes = (drawable(JSON.parse(readFileSync(file, "utf8")))?.lanes ?? []) as LaneDef[];
      } catch {
        // the workflow is gone or broken: lanes go by their ids
      }
      known.set(workflow, lanes);
    }
    return lanes;
  };
}
