// The floor's keys: Ctrl or Cmd with S saves, with Z undoes (Shift redoes), and a window with a change
// not saved asks before it closes. In a text field Z is the field's own undo.
import { type RefObject, useEffect } from "react";

export function useFloorKeys(
  save: () => void,
  dirty: boolean,
  steps: RefObject<{ undo: () => void; redo: () => void; shown: boolean }>,
) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !steps.current.shown) return; // kept aside, the floor takes no key
      if (event.key === "s") {
        event.preventDefault();
        save();
      } else if (
        event.key.toLowerCase() === "z" &&
        !(event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)
      ) {
        event.preventDefault();
        if (event.shiftKey) steps.current.redo();
        else steps.current.undo();
      }
    };
    const onLeave = (event: BeforeUnloadEvent) => dirty && event.preventDefault();
    addEventListener("keydown", onKey);
    addEventListener("beforeunload", onLeave);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("beforeunload", onLeave);
    };
  }, [save, dirty, steps]);
}
