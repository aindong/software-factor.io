// The floor's own state and the buttons that act on its unsaved changes. The state is always said; the
// buttons are there once there is something to undo, revert or save, so that the top bar's first read is
// the workflow's name and what waits. Save is then a stop of the Tab order of its own, and Ctrl or Cmd S too.
import { Ago } from "./Elapsed.tsx";

export function EditBar(props: {
  status: { text: string; bad: boolean; since?: string };
  name: string | undefined;
  /** Something was changed since the workflow was read, or can still be undone or redone. */
  touched: boolean;
  canUndo: boolean;
  dirty: boolean;
  canSave: boolean;
  /** The file was changed elsewhere since this copy was read: the two choices that are left. */
  theirs: boolean;
  /** Revert is asking first, because more than one change would go. */
  discarding: boolean;
  unsavedSteps: number;
  onUndo: () => void;
  onRevert: () => void;
  onAskRevert: () => void;
  onKeep: () => void;
  onSave: (over?: boolean) => void;
}) {
  const { status, touched, dirty, canSave, theirs } = props;
  return (
    <div className="group push">
      <span
        className={`status${status.bad ? " bad" : ""}`}
        role="status"
        title={status.since ? `Saved to ${props.name}.json` : undefined}
      >
        {status.text}
        {status.since ? (
          <>
            {" "}
            <Ago at={status.since} />
          </>
        ) : null}
      </span>
      {touched || theirs ? (
        <>
          <button
            type="button"
            className="button"
            disabled={!props.canUndo}
            onClick={props.onUndo}
            title={
              dirty
                ? "Undo: Ctrl or Cmd and Z"
                : "Undo the last edit, saved or not: Ctrl or Cmd and Z. The file keeps what was saved until you save again."
            }
          >
            {/* with nothing unsaved, what Undo would take back is the last edit that was saved: it says so */}
            {dirty || !props.canUndo ? "Undo" : "Undo last edit"}
          </button>
          {theirs ? (
            // the file changed elsewhere since this copy was read: nothing is written until the person chooses
            <>
              <button type="button" className="button" onClick={props.onRevert}>
                Read the file again
              </button>
              <button type="button" className="button" disabled={!canSave} onClick={() => props.onSave(true)}>
                Save over it
              </button>
            </>
          ) : props.discarding && dirty ? (
            <>
              <span className="status bad">Discard {props.unsavedSteps} changes?</span>
              <button type="button" className="button" onClick={props.onRevert}>
                Discard
              </button>
              <button type="button" className="button" onClick={props.onKeep}>
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button"
              disabled={!dirty}
              // one change is undone as easily as it was made: more than one is asked about first
              onClick={props.unsavedSteps > 1 ? props.onAskRevert : props.onRevert}
            >
              Revert
            </button>
          )}
          {/* while the file is changed elsewhere, the two choices beside it are the ways on */}
          <button
            type="button"
            className="button primary"
            disabled={!canSave || theirs}
            onClick={() => props.onSave()}
          >
            Save
          </button>
        </>
      ) : null}
    </div>
  );
}
