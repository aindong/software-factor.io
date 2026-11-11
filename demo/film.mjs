// Films the README animation: node demo/film.mjs [--light] [--dark] [--scale 2] [--fps 12]
// It serves demo/ with the stageshow copy's vite, steps the stage's virtual clock one frame at a time (so
// every frame is the same on every run), shoots one loop of the script and assembles it with img2webp.
// Writes docs/media/how-it-works-{light,dark}.webp and, beside the copy, one still of each.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const copy = join(here, ".stageshow");
if (!existsSync(join(copy, "node_modules"))) {
  console.error("Run `node demo/setup.mjs` first: it copies the stageshow kit here and installs it.");
  process.exit(2);
}
const args = process.argv.slice(2);
const opt = (name, fallback) =>
  args.includes(`--${name}`) ? Number(args[args.indexOf(`--${name}`) + 1]) : fallback;
const scale = opt("scale", 2);
const fps = opt("fps", 12);
const themes = ["light", "dark"].filter(
  (t) => args.includes(`--${t}`) || !args.some((a) => a === "--light" || a === "--dark"),
);
const out = join(here, "..", "docs", "media");
const stills = join(copy, "stills");
mkdirSync(out, { recursive: true });
mkdirSync(stills, { recursive: true });

const { createServer } = await import(
  pathToFileURL(join(copy, "node_modules", "vite", "dist", "node", "index.js")).href
);
const { launch } = await import(pathToFileURL(join(copy, "scripts", "browser.mjs")).href);
const server = await createServer({
  configFile: join(here, "vite.config.mjs"),
  server: { port: 0 },
  logLevel: "error",
});
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launch();

try {
  for (const theme of themes) {
    const dir = join(copy, "frames", theme);
    const raw = join(copy, "frames", `${theme}-raw`);
    for (const d of [dir, raw]) {
      rmSync(d, { recursive: true, force: true });
      mkdirSync(d, { recursive: true });
    }
    const context = await browser.newContext({
      viewport: { width: 800, height: 352 },
      deviceScaleFactor: scale,
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.error("page error:", e.message));
    await page.goto(`${base}?capture=1&theme=${theme}`);
    await page.waitForSelector(".ss-stage");
    const box = await page.locator("#example").boundingBox();
    const clip = { x: box.x, y: box.y, width: 800, height: 352 };
    await page.evaluate(async () => {
      await window.__clock.settle();
      await window.__clock.flushLayout();
    });
    const mark = () => page.evaluate(() => document.querySelector(".ss-stage")?.getAttribute("data-mark"));
    let frames = 0;
    const says = []; // what the header says in each frame, to find the beats
    // one loop: from the first mark to just before the second
    for (let i = 0; i < fps * 40; i++) {
      await page.evaluate(() => window.__clock.step(1));
      const m = await mark();
      if (m === "cycle2" && frames > 0) break;
      if (m !== "cycle1") continue;
      says.push(
        await page.evaluate(
          () =>
            `${document.querySelector(".fx .state b")?.textContent}|${document.querySelector(".fx-sentence[data-on]")?.textContent ?? ""}`,
        ),
      );
      await page.screenshot({ path: join(raw, `f${String(frames++).padStart(4, "0")}.png`), clip });
    }
    if (!frames || (await mark()) !== "cycle2") throw new Error(`${theme}: did not find one whole loop`);
    // The file starts on the finished frame (the run Done), held, then the reset and the story, so a viewer
    // that never animates sees the poster. Same loop, rotated.
    // three frames past the first Done, so the poster is not caught in the 0.2 s fade of its words
    const done = says.findIndex((t) => t.startsWith("Done|")) + 3;
    const order = [...says.keys()].slice(done).concat([...says.keys()].slice(0, done));
    const files = order.map((k, n) => {
      const to = join(dir, `f${String(n).padStart(4, "0")}.png`);
      copyFileSync(join(raw, `f${String(k).padStart(4, "0")}.png`), to);
      return to;
    });
    copyFileSync(files[0], join(stills, `how-it-works-${theme}.png`));
    const at = (test) => order.findIndex((k) => test(says[k]));
    console.log(
      `${theme} frames: poster 0, Done held to ${frames - done - 1}, gates run ${at((t) => t.includes("gates are running"))}, Ship waits ${at((t) => t.includes("Ship waits"))}`,
    );
    const file = join(out, `how-it-works-${theme}.webp`);
    execFileSync(
      "img2webp",
      ["-loop", "0", "-lossless", "-m", "6", "-d", String(Math.round(1000 / fps)), ...files, "-o", file],
      { stdio: "inherit" },
    );
    console.log(
      `${theme}: ${frames} frames, ${(frames / fps).toFixed(1)} s, ${(statSync(file).size / 1024).toFixed(0)} KB -> ${file}`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
