// The inspector as a sheet (where the window is narrow): what opened it, so that closing it, by Close
// or by Escape, puts the keyboard back there instead of on the page.
import { useRef, useState } from "react";
import { settle } from "./floorKeys.ts";

type Focusable = HTMLElement | SVGElement; // a station is drawn in SVG

export function useSheet() {
  const [sheet, setSheet] = useState(false);
  const head = useRef<HTMLHeadingElement>(null);
  const opener = useRef<Focusable | null>(null);
  const begin = () => {
    const at = document.activeElement;
    // opened again from inside the sheet: what opened it first is still what to go back to
    if (
      (at instanceof HTMLElement || at instanceof SVGElement) &&
      at !== document.body &&
      !at.closest(".inspector")
    )
      opener.current = at;
    setSheet(true);
  };
  const close = () => {
    setSheet(false);
    const to = opener.current?.isConnected ? opener.current : null;
    opener.current = null;
    // a station that is gone, or a button folded away: the fold's own button, else a stable control of the floor
    const back = [to, document.querySelector<HTMLElement>(".topbar button[aria-expanded]")].find(
      (e) => e && e.getBoundingClientRect().width > 0,
    );
    if (back) back.focus();
    else settle();
  };
  return { sheet, head, begin, close };
}
