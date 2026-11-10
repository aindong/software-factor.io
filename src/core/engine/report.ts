// The hand-off to a person: one file per run that says what each lane did, the evidence, what is
// still open, the risk, and why the run stopped or waits. Running out of rounds, a failed gate or
// an approval all end here (ADR 0013).
import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Db } from "../db.ts";
import type { Run, Task } from "../store.ts";
import type { Workspace } from "../workspace.ts";
import { oneLine } from "./lane.ts";
import type { RunState } from "./state.ts";

const NEXT: Record<string, string> = {
  awaiting_approval: "Look at the evidence, then `softwarefactor approve`, `reject` or `send-back` this run.",
  needs_person: 'Read the question, then `softwarefactor answer <run> --note "..."`.',
  waiting: "Nothing to do: `softwarefactor run` continues it when its wait is over.",
  out_of_rounds:
    "The loop used its rounds. Read the last lane's reason and finish the work by hand on the run's branch, or raise maxRounds.",
  no_progress: "The last round brought no new commit. The work needs a person, or a clearer task.",
  lane_failed: "Read the failed lane's reason and evidence. The run's branch and worktree are kept.",
  gate_stop:
    "A gate that must never be worked around failed. A person makes this change, or changes the rule.",
  rejected: "You rejected this run. Its branch is kept if you want to carry on by hand.",
  crashed: "The factory hit an error. The reason is above. Fix it, then put the task back in the queue.",
  done: "Nothing: the work landed.",
};

function summaryOf(path: string): string | undefined {
  try {
    const summary = JSON.parse(readFileSync(path, "utf8")).summary;
    return typeof summary === "string" ? summary : undefined;
  } catch {
    return undefined;
  }
}

export function riskLine(risk: RunState["risk"] | null | undefined): string {
  if (!risk) return "risk: not assessed";
  const raised = risk.raised.length > 0 ? ` Raised by the host: ${risk.raised.join("; ")}.` : "";
  return `risk: ${risk.level}, ${risk.door} door. ${risk.why}${raised}`;
}

export const handoffPath = (ws: Workspace, runId: string) => join(ws.runsDir, runId, "handoff.md");

export function writeRunHandoff(
  ws: Workspace,
  db: Db,
  run: Run,
  task: Task,
  state: RunState,
  status: string,
  code: string,
  reason: string,
): string {
  const lanes = db
    .prepare("select id, lane, outcome, note, handoff_path from lane_runs where run_id = ? order by seq, id")
    .all(run.id) as unknown as {
    id: number;
    lane: string;
    outcome: string | null;
    note: string | null;
    handoff_path: string | null;
  }[];
  const lines = [
    `# Hand-off: ${task.title}`,
    "",
    `Run ${run.id} on branch \`${run.branch}\`. Status: ${status} (${code}). ${reason}`,
    "",
    riskLine(state.risk).replace(/^risk/, "Risk"),
    "",
    "## Lanes",
    "",
  ];
  lanes.forEach((l, i) => {
    lines.push(`${i + 1}. **${l.lane}**: ${l.outcome ?? "not finished"}. ${l.note ?? ""}`.trimEnd());
    // what the agent itself said, when the host's verdict above differs from it
    const said = l.handoff_path ? summaryOf(join(ws.root, l.handoff_path)) : undefined;
    if (said && oneLine(said) !== l.note) lines.push(`   - the agent said: ${oneLine(said)}`);
    const gates = db
      .prepare("select gate, status, output_path from gate_results where lane_run_id = ? order by id")
      .all(l.id) as unknown as {
      gate: string;
      status: string;
      output_path: string;
    }[];
    for (const g of gates) lines.push(`   - gate ${g.gate}: ${g.status}. Evidence: \`${g.output_path}\``);
    const claims = db
      .prepare("select text, evidence from claims where lane_run_id = ? order by id")
      .all(l.id) as unknown as { text: string; evidence: string }[];
    for (const c of claims) {
      const refs = (JSON.parse(c.evidence) as { ref: string; path?: string }[])
        .map((e) => (e.path ? `\`${e.path}\`` : e.ref))
        .join(", ");
      lines.push(`   - claims: ${oneLine(c.text)} Evidence: ${refs}`);
    }
  });
  lines.push("", "## Still open", "");
  const open = state.open ?? [];
  lines.push(
    ...(open.length > 0
      ? open.map((o) => `- ${oneLine(o.text)} (from ${o.lane})`)
      : ["Nothing was listed as open."]),
  );
  lines.push("", "## What to do next", "", NEXT[code] ?? "See the reason above.", "");

  const file = handoffPath(ws, run.id);
  mkdirSync(join(ws.runsDir, run.id), { recursive: true });
  try {
    if (lstatSync(file).isSymbolicLink() || lstatSync(file).isFile()) rmSync(file); // never write through a link
  } catch {
    // not there yet
  }
  writeFileSync(file, lines.join("\n"), { flag: "wx" });
  return relative(ws.root, file);
}
