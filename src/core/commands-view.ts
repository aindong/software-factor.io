// `softwarefactor runs` and `plugins`: printed from the same data the interface shows.
import type { Db } from "./db.ts";
import { UserError } from "./errors.ts";
import { listRuns, runDetail, runDiff } from "./runs/view.ts";
import { pluginsView } from "./views.ts";

type Say = (line: string) => void;

/** `runs`: every run with its sentence. `runs <id>`: one run, lane by lane. `runs <id> --diff`: what it changed. */
export function runsCommand(db: Db, root: string, id: string | undefined, diff: boolean, say: Say): number {
  if (id === undefined) {
    if (diff) throw new UserError("--diff needs a run.", "Name it: softwarefactor runs <run> --diff.");
    const runs = listRuns(db, root);
    if (runs.length === 0) say("No task has run yet. Start one with `softwarefactor run`.");
    for (const r of runs) say(`${r.id}  ${r.status.padEnd(8)} ${r.task}\n    ${r.sentence}`);
    return 0;
  }
  const run = runDetail(db, root, id);
  if (!run) throw new UserError(`There is no run "${id}".`, "See the run ids with `softwarefactor runs`.");
  if (diff) {
    const changed = runDiff(db, root, id);
    if (changed?.note) say(changed.note);
    for (const line of changed?.changed ?? []) say(line);
    if (changed?.diff) say(`\n${changed.diff}`);
    if (changed?.cut) say("The diff is long: only its first part is shown.");
    return 0;
  }
  say(`${run.id}  ${run.status}  ${run.task}  (branch ${run.branch})`);
  say(`  ${run.sentence}`);
  for (const lane of run.lanes) {
    say(`  ${lane.lane}  ${lane.outcome ?? "running"}${lane.note ? `  ${lane.note}` : ""}`);
    for (const g of lane.gates) say(`    gate ${g.gate}  ${g.status}  ${g.output}`);
    for (const c of lane.claims) say(`    claims: ${c.text}  [${c.evidence.map((e) => e.ref).join(", ")}]`);
    if (lane.handoff) say(`    hand-off: ${lane.handoff}`);
  }
  for (const item of run.inbox) say(`  waiting: ${item.body}`);
  for (const file of run.files)
    say(`  file: ${file.path}${file.name === file.path.split("/").pop() ? "" : `  (${file.name})`}`);
  return 0;
}

/** `plugins`: what this version has built in. */
export function pluginsCommand(root: string, say: Say): number {
  const built = pluginsView(root);
  say(`Lane types   ${built.lanes.join(", ")}`);
  say(`Gate types   ${built.gates.join(", ")}`);
  say(`Collectors   ${built.collectors.join(", ")}`);
  say(`Agents       ${built.agents.join(", ")}`);
  say("Workflows");
  for (const w of built.workflows) say(`  ${w.name.padEnd(16)} ${w.description}`);
  say("Plugins");
  for (const p of built.installed) say(`  ${p.name} ${p.version}  ${p.adds.join(", ")}`);
  say(built.installing);
  return 0;
}
