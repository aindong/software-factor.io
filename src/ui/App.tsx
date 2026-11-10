// The shell: the navy rail with the six sections, and the section that is open.
import { useEffect, useState } from "react";
import { Accounts } from "./Accounts.tsx";
import { hasKey } from "./api.ts";
import { Costs } from "./Costs.tsx";
import { Floor } from "./Floor.tsx";
import { Inbox } from "./Inbox.tsx";
import { icons } from "./icons.tsx";
import { useRuns } from "./live.ts";
import { Plugins } from "./Plugins.tsx";
import { Runs } from "./Runs.tsx";
import { go, usePath } from "./route.ts";
import { showInTab } from "./tab.ts";
import { standing } from "./words.ts";
import "./sections.css";

// each section has a key: g, then its letter, from anywhere but a text field
const SECTIONS = [
  { path: "/", name: "Floor", icon: "floor", key: "f" },
  { path: "/runs", name: "Runs", icon: "runs", key: "r" },
  { path: "/inbox", name: "Inbox", icon: "inbox", key: "i" },
  { path: "/accounts", name: "Accounts", icon: "accounts", key: "a" },
  { path: "/plugins", name: "Plugins", icon: "plugins", key: "p" },
  { path: "/costs", name: "Costs", icon: "costs", key: "c" },
] as const;
const typing = (target: EventTarget | null) =>
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLInputElement ||
  target instanceof HTMLSelectElement;

const THEMES = ["auto", "light", "dark"] as const;
type Theme = (typeof THEMES)[number];
function storedTheme(): Theme {
  try {
    const saved = localStorage.getItem("factor-theme");
    return THEMES.find((t) => t === saved) ?? "auto";
  } catch {
    return "auto"; // storage can be blocked: the system's setting then decides
  }
}

export function App() {
  const path = usePath();
  const [theme, setTheme] = useState<Theme>(storedTheme);

  // g, then a section's letter. After g the next key is for this and for nothing else, however
  // long it takes: a screen's own keys (the inbox's a approves) must never get a key that was
  // meant as the second half. The rail shows each section's letter while it waits.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    let waiting = false;
    const drop = () => {
      waiting = false;
      setArmed(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (typing(event.target)) return drop(); // typing in a field ends the wait: its letters are the field's
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      if (!waiting) {
        if (event.key !== "g") return;
        waiting = true;
        setArmed(true);
        event.preventDefault();
        return;
      }
      waiting = false;
      setArmed(false);
      event.preventDefault();
      event.stopImmediatePropagation();
      const to = SECTIONS.find((s) => s.key === event.key);
      if (to) go(to.path);
    };
    addEventListener("keydown", onKey, true);
    addEventListener("pointerdown", drop, true); // so does a press of the pointer anywhere
    return () => {
      removeEventListener("keydown", onKey, true);
      removeEventListener("pointerdown", drop, true);
    };
  }, []);
  const [unsaved, setUnsaved] = useState(false); // the floor holds changes that are not saved
  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("factor-theme", theme);
    } catch {
      // not kept for next time
    }
  }, [theme]);

  // a section owns its address and what is open under it
  const section =
    SECTIONS.find((s) => s.path === path || (s.path !== "/" && path.startsWith(`${s.path}/`))) ?? SECTIONS[0];
  // how many runs wait for a person: shown on the rail, in the colour of what a person can act on
  const { runs } = useRuns();
  const waits = hasKey ? (runs ?? []).filter((r) => standing(r).mark === "asked").length : 0;
  const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? "auto";
  useEffect(() => showInTab(section.name, waits), [section.name, waits]);

  return (
    <div className="shell">
      <nav className={`rail${armed ? " armed" : ""}`} aria-label="Sections">
        {SECTIONS.map((s) => (
          <a
            key={s.path}
            href={s.path}
            aria-current={s.path === section.path ? "page" : undefined}
            aria-keyshortcuts={`g ${s.key}`}
            data-key={s.key}
            title={`${s.name}: g then ${s.key}`}
            onClick={(event) => {
              event.preventDefault();
              go(s.path);
            }}
          >
            {icons[s.icon]}
            {s.name}
            {s.path === "/" && unsaved ? (
              <span className="unsaved" role="img" aria-label=", not saved" />
            ) : null}
            {s.path === "/inbox" && waits > 0 ? (
              <span className="count">
                {waits}
                <span className="sr"> {waits === 1 ? "waits" : "wait"} for you</span>
              </span>
            ) : null}
          </a>
        ))}
        <span className="spacer" />
        <button
          type="button"
          onClick={() => setTheme(nextTheme)}
          title={`Theme: ${theme}. Switch to ${nextTheme}.`}
        >
          {icons.theme}
          {theme === "auto" ? "Auto" : theme === "light" ? "Light" : "Dark"}
        </button>
      </nav>
      {!hasKey ? (
        <main className="work">
          <div className="topbar">
            <h1>This tab has no key</h1>
          </div>
          <div className="plain">
            <p>
              The interface reads and saves your workflows, so it answers only to the address that{" "}
              <code>softwarefactor ui</code> printed in your terminal. That address ends in <code>#t=</code>{" "}
              and a key.
            </p>
            <p>Open that address as it is, in this tab.</p>
          </div>
        </main>
      ) : (
        <>
          {section.path === "/runs" ? (
            <Runs />
          ) : section.path === "/inbox" ? (
            <Inbox />
          ) : section.path === "/accounts" ? (
            <Accounts />
          ) : section.path === "/plugins" ? (
            <Plugins />
          ) : section.path === "/costs" ? (
            <Costs />
          ) : null}
          {/* the floor stays as it was left while another section is open: unsaved work is not thrown away */}
          <Floor shown={section.path === "/"} onUnsaved={setUnsaved} />
        </>
      )}
    </div>
  );
}
