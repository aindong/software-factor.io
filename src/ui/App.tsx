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
import { standing } from "./words.ts";
import "./sections.css";

const SECTIONS = [
  { path: "/", name: "Floor", icon: "floor" },
  { path: "/runs", name: "Runs", icon: "runs" },
  { path: "/inbox", name: "Inbox", icon: "inbox" },
  { path: "/accounts", name: "Accounts", icon: "accounts" },
  { path: "/plugins", name: "Plugins", icon: "plugins" },
  { path: "/costs", name: "Costs", icon: "costs" },
] as const;

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
  const [path, setPath] = useState(location.pathname);
  const [theme, setTheme] = useState<Theme>(storedTheme);

  useEffect(() => {
    const back = () => setPath(location.pathname);
    addEventListener("popstate", back);
    return () => removeEventListener("popstate", back);
  }, []);
  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("factor-theme", theme);
    } catch {
      // not kept for next time
    }
  }, [theme]);

  const go = (to: string) => {
    history.pushState(null, "", to);
    setPath(to);
  };
  const section = SECTIONS.find((s) => s.path === path) ?? SECTIONS[0];
  // how many runs wait for a person: shown on the rail, in the colour of what a person can act on
  const { runs } = useRuns();
  const waits = hasKey ? (runs ?? []).filter((r) => standing(r).mark === "asked").length : 0;
  const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? "auto";

  return (
    <div className="shell">
      <nav className="rail" aria-label="Sections">
        {SECTIONS.map((s) => (
          <a
            key={s.path}
            href={s.path}
            aria-current={s.path === section.path ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              go(s.path);
            }}
          >
            {icons[s.icon]}
            {s.name}
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
      ) : section.path === "/runs" ? (
        <Runs />
      ) : section.path === "/inbox" ? (
        <Inbox />
      ) : section.path === "/accounts" ? (
        <Accounts />
      ) : section.path === "/plugins" ? (
        <Plugins />
      ) : section.path === "/costs" ? (
        <Costs />
      ) : (
        <Floor />
      )}
    </div>
  );
}
