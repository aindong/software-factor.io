import { useEffect, useState } from "react";

// An experiment: choose the type system and the dark palette by eye. Each choice is a data attribute on
// the root element (types.css) and is kept in localStorage.
const GROUPS = [
  { key: "type", label: "Type", options: ["today", "inter", "plex", "system"] },
  { key: "dark", label: "Dark", options: ["today", "neutral", "cool", "dimmed"] },
  { key: "wt", label: "Body weight", options: ["380", "400"] },
  { key: "size", label: "Data size", options: ["14", "15"] },
] as const;
type Key = (typeof GROUPS)[number]["key"];
type Choice = Record<Key, string>;
const FIRST: Choice = { type: "today", dark: "today", wt: "380", size: "14" };
const STORE = "factor-type-try";

function load(): Choice {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "{}") as Partial<Choice>;
    const ok = (k: Key) => GROUPS.find((g) => g.key === k)?.options.some((o) => o === raw[k]);
    return Object.fromEntries(GROUPS.map((g) => [g.key, ok(g.key) ? raw[g.key] : FIRST[g.key]])) as Choice;
  } catch {
    return FIRST;
  }
}

function apply(c: Choice): void {
  for (const k of Object.keys(c) as Key[]) document.documentElement.dataset[k] = c[k];
}

/** Called before the first render, so the page paints with the saved choice. */
export function applyStored(): void {
  apply(load());
}

/** A computed colour as sRGB, by drawing it: the browser does the oklch conversion. */
function rgb(token: string): [number, number, number] {
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!c) return [0, 0, 0];
  c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(token).trim() || "#000";
  c.fillRect(0, 0, 1, 1);
  const d = c.getImageData(0, 0, 1, 1).data;
  return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
}
function lum([r, g, b]: [number, number, number]): number {
  const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a: string, b: string): string {
  const [x, y] = [lum(rgb(a)), lum(rgb(b))];
  return ((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(1);
}

export function Switcher() {
  const [choice, setChoice] = useState<Choice>(load);
  const [open, setOpen] = useState(true);
  const [line, setLine] = useState("");

  useEffect(() => {
    apply(choice);
    try {
      localStorage.setItem(STORE, JSON.stringify(choice));
    } catch {
      /* storage can be blocked: the choice then lasts until the page closes */
    }
    const measure = () =>
      setLine(
        `Text ${ratio("--ink", "--ground")}:1, soft text ${ratio("--ink-soft", "--ground")}:1 on the ground`,
      );
    measure();
    const dark = matchMedia("(prefers-color-scheme: dark)");
    dark.addEventListener("change", measure);
    const watch = new MutationObserver(measure); // the page's own theme switch changes data-theme
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      dark.removeEventListener("change", measure);
      watch.disconnect();
    };
  }, [choice]);

  return (
    <aside className="switcher" aria-label="Type and dark palette experiment">
      <button type="button" className="switcher-fold" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Fold away" : "Type and dark"}
      </button>
      {open && (
        <>
          {GROUPS.map((g) => (
            <div className="switcher-row" key={g.key}>
              <span>{g.label}</span>
              {g.options.map((o) => (
                <button
                  type="button"
                  key={o}
                  aria-pressed={choice[g.key] === o}
                  onClick={() => setChoice({ ...choice, [g.key]: o })}
                >
                  {o === "today" ? "Today" : o[0]?.toUpperCase() + o.slice(1)}
                </button>
              ))}
            </div>
          ))}
          <p aria-live="polite">{line}</p>
        </>
      )}
    </aside>
  );
}
