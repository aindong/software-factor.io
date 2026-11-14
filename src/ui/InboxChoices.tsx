// The decision bar's buttons: Answer for a question, Approve, Reject and Send back for an approval, or
// the note's own Send and Cancel. Under the first set, one quiet line says what Reject and Send back do.
import type { Decision } from "../core/views.ts";
import { DOING } from "./outside.ts";

export function InboxChoices({
  question,
  noting,
  sending,
  sendBack,
  says,
  act,
  send,
  decide,
  ask,
  cancel,
}: {
  question: boolean;
  noting: "reject" | "send-back" | undefined;
  sending: Decision | undefined;
  sendBack: boolean;
  /** What Reject and Send back do, before they are pressed. */
  says: string | undefined;
  /** The command a one-way approval runs: the button is named after it, and the step cannot be undone. */
  act: string | undefined;
  send: () => void;
  decide: (decision: Decision) => void;
  ask: (decision: "reject" | "send-back") => void;
  cancel: () => void;
}) {
  const busy = sending !== undefined;
  const label = (decision: Decision, words: string) => (sending === decision ? DOING[decision] : words);
  if (question) {
    return (
      <div className="choices">
        <button type="button" className="button approve" disabled={busy} onClick={send}>
          {label("answer", "Answer")}
        </button>
      </div>
    );
  }
  if (noting) {
    return (
      <div className="choices">
        <button type="button" className="button primary" disabled={busy} onClick={send}>
          {label(noting, noting === "reject" ? "Reject" : "Send back")}
        </button>
        <button type="button" className="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <>
      <div className="choices">
        <button type="button" className="button approve" disabled={busy} onClick={() => decide("approve")}>
          {sending === "approve" ? (
            DOING.approve
          ) : (
            <>
              {act ? `Approve and run ${act}` : "Approve"} <kbd>a</kbd>
            </>
          )}
        </button>
        <button type="button" className="button" disabled={busy} onClick={() => ask("reject")}>
          Reject <kbd>r</kbd>
        </button>
        {sendBack ? (
          <button type="button" className="button" disabled={busy} onClick={() => ask("send-back")}>
            Send back <kbd>s</kbd>
          </button>
        ) : null}
      </div>
      {act ? <p className="consequence final">Approve: this cannot be undone.</p> : null}
      {says ? <p className="consequence">{says}</p> : null}
    </>
  );
}
