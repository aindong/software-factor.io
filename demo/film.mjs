// Films the README picture: a real recording of the interface, a first run on the scripted agent.
//   node demo/film.mjs [--light] [--dark] [--lossy]     (pnpm run demo:film)
// For each theme it makes a scratch project in a temporary folder with its own FACTOR_HOME, starts
// `softwarefactor ui` on a free port, and has `playwright-cli run-code` (demo/capture.js) press the keys of the
// first run while it shoots frames. The frames are put together with `img2webp`, each one held for as long as
// it was on screen. Frames are left in demo/frames/<theme>/ (ignored by git). Needs a build.
import { execFile, execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const cli = join(root, "dist", "cli.js");
const args = process.argv.slice(2);
const themes = ["light", "dark"].filter(
  (t) => args.includes(`--${t}`) || !args.some((a) => a === "--light" || a === "--dark"),
);
const size = { width: 940, height: 540 }; // below 1000 px the Floor's side panel folds away, so Done fits
const lane = 1000; // how long each scripted lane works, in milliseconds
const hold = 1500; // the last frame stays this long

const have = (cmd) => {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
if (!existsSync(cli) || !existsSync(join(root, "dist", "ui", "index.html"))) {
  console.error("Build first: pnpm run build");
  process.exit(2);
}
for (const [cmd, how] of [
  ["playwright-cli", "the Playwright CLI (npm i -g @playwright/cli)"],
  ["img2webp", "brew install webp"],
]) {
  if (!have(cmd)) {
    console.error(`${cmd} is needed: ${how}`);
    process.exit(2);
  }
}

const temp = mkdtempSync(join(tmpdir(), "softwarefactor-film-"));
const children = new Set();
const sessions = new Set();
const cleanup = () => {
  for (const c of children) c.kill();
  for (const s of sessions) {
    try {
      execFileSync("playwright-cli", [`-s=${s}`, "close"], { stdio: "ignore" });
    } catch {}
  }
  rmSync(temp, { recursive: true, force: true });
};
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    cleanup();
    process.exit(130);
  });
}

const pw = (session, ...a) => {
  try {
    return execFileSync("playwright-cli", [`-s=${session}`, ...a], { encoding: "utf8" });
  } catch (e) {
    throw new Error(`playwright-cli ${a[0]} failed: ${e.stdout || e.message}`);
  }
};

async function film(theme) {
  const dir = join(temp, theme);
  const project = join(dir, "hello-factory");
  const env = { ...process.env, FACTOR_HOME: join(dir, "home") };
  mkdirSync(project, { recursive: true });
  const run = (cmd, a) => execFileSync(cmd, a, { cwd: project, env, encoding: "utf8", stdio: "pipe" });
  const git = (...a) => run("git", ["-c", "user.email=film@example.com", "-c", "user.name=Film", ...a]);
  git("init", "-q", "-b", "main");
  writeFileSync(
    join(project, "package.json"),
    '{ "name": "hello", "private": true, "scripts": { "test": "node --test" } }\n',
  );
  git("add", "-A");
  git("commit", "-q", "-m", "start");
  run("node", [cli, "init"]);
  // the scripted agent works for a while in every lane, so that each lane's working state can be seen
  const localPath = join(project, ".factor", "local.json");
  const local = JSON.parse(readFileSync(localPath, "utf8"));
  for (const role of Object.values(local.roles))
    for (const steps of Object.values(role.script)) steps.unshift({ sleep: lane });
  writeFileSync(localPath, JSON.stringify(local, null, 2));
  git("add", "-A");
  git("commit", "-q", "-m", "a factory");

  const ui = spawn("node", [cli, "ui", "--port", "0"], { cwd: project, env });
  children.add(ui);
  let log = "";
  for (const stream of [ui.stdout, ui.stderr])
    stream.on("data", (d) => {
      log += d;
    });
  let address;
  for (let i = 0; i < 100 && !address; i++) {
    address = /http:\/\/127\.0\.0\.1:\d+\/#t=[0-9a-f]+/.exec(log)?.[0];
    if (!address) await new Promise((r) => setTimeout(r, 100));
  }
  if (!address) throw new Error(`the interface did not start: ${log}`);

  const frames = join(here, "frames", theme);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const session = `film-${process.pid}-${theme}`;
  sessions.add(session);
  pw(session, "open", address);
  pw(session, "resize", String(size.width), String(size.height));
  pw(session, "set-color-scheme", theme);
  const code = join(dir, "capture.js");
  // run-code wants a function expression: the formatter's closing semicolon is cut off
  const snippet = readFileSync(join(here, "capture.js"), "utf8").trim().replace(/;$/, "");
  writeFileSync(code, snippet.replaceAll("__FRAMES__", frames));

  // the first run starts a moment after the first frame, so the film opens on the Floor with nothing on it yet
  const starter = setInterval(() => {
    if (readdirSync(frames).length === 0) return;
    clearInterval(starter);
    setTimeout(() => {
      children.add(spawn("node", [cli, "run"], { cwd: project, env, stdio: "ignore" }));
    }, 600);
  }, 50);
  try {
    // not execFileSync: the timer above must go on while the page is driven
    const said = await new Promise((resolve, reject) =>
      execFile("playwright-cli", [`-s=${session}`, "run-code", "--filename", code], (e, out) =>
        e || /### Error/.test(out) ? reject(new Error(`run-code failed: ${out}`)) : resolve(out),
      ),
    );
    console.log(`${theme}: ${said.split("\n")[1]}`);
  } finally {
    clearInterval(starter);
  }
  pw(session, "close");
  sessions.delete(session);
  ui.kill();
  children.delete(ui);
  return frames;
}

function assemble(theme, frames) {
  // each file is <number>-<ms>.png: it is held until the next one was shot, and a frame the same as the one
  // before is not stored twice but held longer
  const shots = readdirSync(frames)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => ({ file: join(frames, f), at: Number(/-(\d+)\.png$/.exec(f)[1]) }));
  const parts = [];
  let previous;
  shots.forEach((s, i) => {
    const ms = i + 1 < shots.length ? shots[i + 1].at - s.at : hold;
    const bytes = readFileSync(s.file);
    if (previous?.bytes.equals(bytes)) previous.ms += ms;
    else {
      previous = { file: s.file, bytes, ms };
      parts.push(previous);
    }
  });
  parts[parts.length - 1].ms = Math.max(parts[parts.length - 1].ms, hold);
  const out = join(root, "docs", "media", `how-it-works-${theme}.webp`);
  const quality = args.includes("--lossy") ? ["-lossy", "-q", "90"] : ["-lossless"];
  execFileSync(
    "img2webp",
    ["-loop", "0", ...quality, ...parts.flatMap((p) => ["-d", String(p.ms), p.file]), "-o", out],
    { stdio: "pipe" },
  );
  const total = parts.reduce((t, p) => t + p.ms, 0);
  console.log(
    `${theme}: ${shots.length} frames shot, ${parts.length} kept, ${(total / 1000).toFixed(1)} s, ${(statSync(out).size / 1024).toFixed(0)} KB`,
  );
}

try {
  for (const theme of themes) assemble(theme, await film(theme));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
