// A person's decision on a waiting run: approve, reject, send back with a note, or answer a question.
// The run then continues from its saved state, in this process.
import { openDb } from "../db.ts";
import { UserError } from "../errors.ts";
import * as store from "../store.ts";
import type { Workspace } from "../workspace.ts";
import { preflight } from "./preflight.ts";
import { freeDeadSlots } from "./recover.ts";
import { advance, applyOutcome, contextFor, crashed, type RunSummary } from "./run.ts";
import { maxSlots, slotEnv } from "./slots.ts";
import { addNote } from "./state.ts";

export type Decision = "approve" | "reject" | "send-back" | "answer";

export async function decide(
  ws: Workspace,
  runId: string,
  decision: Decision,
  note: string,
  /** Told at once that the decision is recorded, before the run goes on: what waits on it need not wait for the run. */
  taken?: (line: string) => void,
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
    if (!store.takeWaitingRun(db, runId)) {
      throw new UserError(
        `Run ${runId} is not waiting any more: another process just moved it.`,
        "Look again with `softwarefactor status`.",
      );
    }
    freeDeadSlots(db); // a run whose process died must not keep this one waiting
    const slot = store.claimSlot(db, runId, maxSlots(ws));
    ctx.slotEnv = slotEnv(ws, slot);
    if (slot === undefined) {
      store.endRun(
        db,
        runId,
        "waiting",
        run.stop_code ?? "awaiting_approval",
        run.stop_reason ?? "",
        run.wake_at,
      );
      throw new UserError(
        `Every slot is busy, so run ${runId} cannot continue yet.`,
        "Decide again when a run has finished, or raise slots.max in .factor/factory.json.",
      );
    }
    store.closeInbox(db, item.id, closed[decision], note);
    store.setTaskStatus(db, run.task_id, "running");
    state.parked = undefined;
    const recorded = `run ${runId}: ${closed[decision].replace("_", " ")}${note ? ` ("${note}")` : ""}`;
    if (taken) taken(recorded);
    else log.push(recorded);

    try {
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
    } catch (error) {
      return crashed(ctx, error); // the decision is recorded, so the run must not be left "running"
    }
  } finally {
    db.close();
  }
}
