// A person's decision on a waiting run: approve, reject, send back with a note, or answer a question.
// The run then continues from its saved state, in this process.
import { openDb } from "../db.ts";
import { UserError } from "../errors.ts";
import * as store from "../store.ts";
import type { Workspace } from "../workspace.ts";
import { preflight } from "./preflight.ts";
import { advance, applyOutcome, contextFor, type RunSummary } from "./run.ts";
import { addNote } from "./state.ts";

export type Decision = "approve" | "reject" | "send-back" | "answer";

export async function decide(
  ws: Workspace,
  runId: string,
  decision: Decision,
  note: string,
): Promise<RunSummary> {
  preflight(ws);
  const db = openDb(ws.dbPath);
  try {
    const run = store.getRun(db, runId);
    if (!run)
      throw new UserError(`There is no run "${runId}".`, "See the run ids with `softwarefactor status`.");
    const item = store.openInboxFor(db, runId);
    if (run.status !== "waiting" || !item) {
      throw new UserError(
        `Run ${runId} is not waiting for a person (it is ${run.status}).`,
        "See what is waiting with `softwarefactor inbox`.",
      );
    }
    const log: string[] = [];
    const ctx = contextFor(ws, db, run, log);
    const { state } = ctx;
    const parked = state.parked;
    const lane = ws.workflow.lanes.find((l) => l.id === parked?.lane);
    if (!parked || !lane) throw new Error(`run ${runId} is waiting but has no parked lane`);

    const isQuestion = parked.kind === "answer";
    if (isQuestion !== (decision === "answer")) {
      throw new UserError(
        isQuestion ? `Run ${runId} asked a question.` : `Run ${runId} waits for an approval, not an answer.`,
        isQuestion ? 'Use `softwarefactor answer <run> --note "..."`.' : "Use approve, reject or send-back.",
      );
    }
    if ((decision === "send-back" || decision === "answer") && note.trim() === "") {
      throw new UserError(`"${decision}" needs a note.`, 'Add --note "what the lane should know".');
    }
    if (decision === "send-back" && parked.kind === "approve-before") {
      throw new UserError(
        `Lane "${lane.id}" has not run yet, so there is no work to send back.`,
        "Use approve or reject.",
      );
    }

    const closed = {
      approve: "approved",
      reject: "rejected",
      "send-back": "sent_back",
      answer: "answered",
    } as const;
    store.closeInbox(db, item.id, closed[decision], note);
    store.resumeRun(db, runId);
    store.setTaskStatus(db, run.task_id, "running");
    state.parked = undefined;
    log.push(`run ${runId}: ${closed[decision].replace("_", " ")}${note ? ` ("${note}")` : ""}`);

    let ended: RunSummary | undefined;
    if (decision === "approve" && parked.kind === "approve-before") {
      state.approved = lane.id; // the lane now runs
    } else if (decision === "approve") {
      ended = applyOutcome(ctx, lane, "pass", parked.note ?? "");
    } else if (decision === "reject") {
      const why = note || "rejected by a person";
      if (parked.laneRun !== undefined) store.setLaneOutcome(db, parked.laneRun, "fail", why);
      else store.endLane(db, store.startLane(db, runId, lane.id, state.seq), "fail", why, null);
      state.rejected = true;
      ended = applyOutcome(ctx, lane, "fail", why);
      state.rejected = false;
    } else {
      // send back, or an answer: the same lane runs again and is told why
      addNote(
        state,
        lane.id,
        decision === "answer" ? `A person answered: ${note}` : `A person sent this back: ${note}`,
      );
      state.next = lane.id;
      state.seq += 1;
    }
    store.saveState(db, runId, state);
    return ended ?? (await advance(ctx));
  } finally {
    db.close();
  }
}
