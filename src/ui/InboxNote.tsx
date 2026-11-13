// The box for a typed answer, or for what a rejection or a send-back is to say.
import type { Ref } from "react";

export function InboxNote({
  question,
  noting,
  box,
  note,
  setNote,
  fieldSaid,
  setFieldSaid,
  send,
  leave,
}: {
  question: boolean;
  noting: "reject" | "send-back" | undefined;
  box: Ref<HTMLTextAreaElement>;
  note: string;
  setNote: (note: string) => void;
  fieldSaid: string | undefined;
  setFieldSaid: (said: string | undefined) => void;
  send: () => void;
  leave: () => void;
}) {
  return (
    <label className="field">
      <span className="label">
        {question ? "Your answer" : noting === "reject" ? "Why (optional)" : "What should change"}
      </span>
      <textarea
        ref={box}
        rows={2}
        value={note}
        aria-invalid={fieldSaid !== undefined}
        onChange={(event) => {
          setNote(event.target.value);
          setFieldSaid(undefined);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return; // Enter that ends a composition is not "send"
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          } else if (event.key === "Escape" && !question) leave();
        }}
      />
      {fieldSaid ? (
        <span className="hint bad" role="alert">
          {fieldSaid}
        </span>
      ) : (
        <span className="hint">
          Enter sends. Shift and Enter makes a new line.{question ? "" : " Escape leaves it."}
        </span>
      )}
    </label>
  );
}

/** The keys of a list of rows, as the Floor's legend writes keys. Not shown at phone width. */
export function KeyHint({ things }: { things: string }) {
  return (
    <p className="keyhint">
      <kbd>↑</kbd> <kbd>↓</kbd> move between {things}, <kbd>Enter</kbd> opens
    </p>
  );
}
