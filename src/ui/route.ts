// Where the page is: the section, and what is open in it (`/runs/<run>`, `/inbox/<run>`). It is
// kept in the address, so Back, a reload and a link printed in a terminal all lead to the same.
import { useSyncExternalStore } from "react";

const tell = (change: () => void) => {
  addEventListener("popstate", change);
  return () => removeEventListener("popstate", change);
};
export const usePath = (): string => useSyncExternalStore(tell, () => location.pathname);
/** The query of the address (`?show=working`): a view of the section that a reload and a link keep. */
export const useSearch = (): string => useSyncExternalStore(tell, () => location.search);

/** Go somewhere in the page. With `replace`, Back does not stop at where the page was. */
export function go(to: string, replace = false): void {
  if (to === location.pathname + location.search) return;
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}
/** What is open in a section: the part of the address after the section's own. */
export function openIn(path: string, section: string): string | undefined {
  if (!path.startsWith(`${section}/`)) return undefined;
  const rest = path.slice(section.length + 1).replace(/\/+$/, ""); // a slash at the end names nothing more
  try {
    return decodeURIComponent(rest) || undefined;
  } catch {
    return rest || undefined; // an address that does not decode is taken as it is written
  }
}
