// The inbox's deciding keys work only while the keyboard is in the inbox: a key pressed with
// nothing chosen by the person must not decide. Pressed anywhere else they are answered, not
// met with silence. `g` and the key after it never come here: the shell takes them first.
// On arrival the inbox puts the keyboard on its heading, one Tab before the list: nothing is
// chosen yet, and the first item is one key away.
import { useEffect } from "react";
import type { Decision } from "../core/views.ts";

export const DONE: Record<Decision, string> = {
  approve: "Approved",
  reject: "Rejected",
  "send-back": "Sent back",
  answer: "Answered",
};
export const DOING: Record<Decision, string> = {
  approve: "Approving...",
  reject: "Rejecting...",
  "send-back": "Sending back...",
  answer: "Answering...",
};
/** What a deciding key pressed outside the list is answered with. It goes once an item is chosen. */
export const HINT = "Choose an item first: Tab moves to the list.";

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
