// The shell: the navy rail with the six sections, and the section that is open.
import { useEffect, useState } from "react";
import { hasKey } from "./api.ts";
import { Floor } from "./Floor.tsx";
import { icons } from "./icons.tsx";
import { Runs } from "./Runs.tsx";

const SECTIONS = [
  { path: "/", name: "Floor", icon: "floor" },
  { path: "/runs", name: "Runs", icon: "runs" },
  { path: "/inbox", name: "Inbox", icon: "inbox" },
  { path: "/accounts", name: "Accounts", icon: "accounts" },
  { path: "/plugins", name: "Plugins", icon: "plugins" },
  { path: "/costs", name: "Costs", icon: "costs" },
] as const;

// What each section that is not built yet will hold, and how to get the same today.
const LATER: Record<string, { what: string; today: string }> = {
  "/inbox": {
    what: "Approvals and questions that wait for you, each answerable with one key.",
    today: "softwarefactor inbox",
  },
  "/accounts": {
    what: "The agent logins on this machine, and which one works each role.",
    today: "softwarefactor account list",
  },
  "/plugins": {
    what: "Lanes, gates and collectors that others have shared, to add to this factory.",
    today: "",
  },
  "/costs": { what: "Tokens and cost by lane, by task and by account.", today: "softwarefactor sessions" },
};

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
  const later = LATER[section.path];
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
      ) : later ? (
        <main className="work">
          <div className="topbar">
            <h1>{section.name}</h1>
          </div>
          <div className="plain">
            <p>{later.what}</p>
            <p>
              This part of the interface is not built yet.
              {later.today ? (
                <>
                  {" "}
                  Until it is, the same is on the command line: <code>{later.today}</code>
                </>
              ) : null}
            </p>
          </div>
        </main>
      ) : section.path === "/runs" ? (
        <Runs />
      ) : (
        <Floor />
      )}
    </div>
  );
}
