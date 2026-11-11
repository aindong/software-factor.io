// What a section's top bar says when the factory cannot be reached: waiting helps, unless this
// tab's key was refused for good, and then only the new address does.
import { useSyncExternalStore } from "react";
import { keyRefused } from "./api.ts";

const tell = (change: () => void) => {
  addEventListener("factor:refused", change);
  addEventListener("factor:key", change);
  return () => {
    removeEventListener("factor:refused", change);
    removeEventListener("factor:key", change);
  };
};
/** Whether this tab is kept with a key the server no longer takes. */
export const useKeyRefused = (): boolean => useSyncExternalStore(tell, keyRefused);

export function Offline() {
  return (
    <span className="status bad" role="status">
      {useKeyRefused()
        ? "This tab's key is refused. Paste the new address."
        : "Not connected to the factory. Trying again."}
    </span>
  );
}
