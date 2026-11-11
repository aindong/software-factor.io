// The inbox's deciding keys work only while the keyboard is in the inbox: a key pressed with
// nothing chosen by the person must not decide. Pressed anywhere else they are answered, not
// met with silence. `g` and the key after it never come here: the shell takes them first.
// On arrival the inbox puts the keyboard on its heading, one Tab before the list: nothing is
// chosen yet, and the first item is one key away.
import { useEffect } from "react";

export function useDecidingKeyOutside(on: boolean, say: () => void): void {
  useEffect(() => {
    if (!on) return;
    const hear = (event: KeyboardEvent) => {
      const at = event.target as Element | null;
      if (!["a", "r", "s"].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (at?.closest?.(".inbox, input, textarea, select, [contenteditable]")) return;
      say();
    };
    addEventListener("keydown", hear);
    return () => removeEventListener("keydown", hear);
  }, [on, say]);
}
