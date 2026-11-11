// The host page. ?theme=dark draws the night palette; ?capture=1 puts the stage on a virtual clock that
// film.mjs steps frame by frame. The page's own ground is GitHub's, so the picture has no edge on a README.
import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow-semi-condensed/latin-500.css";
import "@fontsource/barlow-semi-condensed/latin-600.css";
import "../src/ui/tokens.css";
import "../src/ui/app.css";
import "../src/ui/floor.css";
import "../src/ui/runs.css";
import "../src/ui/sections.css";
import "../src/ui/working.css";
import "./host.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installVirtualClock } from "./.stageshow/kit";
import Factory from "./Factory.tsx";

const params = new URLSearchParams(location.search);
const film = (window as { __stageshow?: { theme?: string } }).__stageshow;
const dark = params.get("theme") === "dark" || film?.theme === "dark";
document.documentElement.dataset.theme = dark ? "dark" : "light";
if (params.has("capture"))
  (window as unknown as { __clock: unknown }).__clock = installVirtualClock({ fps: 12 });

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <div id="example">
        <Factory />
      </div>
    </StrictMode>,
  );
}
