#!/bin/bash
# A run's page is for someone who did not build the factory, in a real browser, by keyboard: what it
# is doing and whether it needs them are said in plain words first; a lane's summary is whole
# sentences, never cut in the middle of one; the references, gates and hand-off are not on the page
# until the lane's evidence is opened (and open in place when it is); and no text is small.
# Needs playwright-cli and a built command (pnpm run build). The page is only read.
# Usage: bash test/ui/readable.sh [folder for screenshots]
# Prints "readable: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="readable-$$"
server=""
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }

# the contrast of every text of the run's map against what is behind it, from computed styles; and whether the routes not taken are quieter
map_contrast='() => {
  const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const rgba = (c) => { cv.fillStyle = "#ff00ff"; cv.fillStyle = c; if (cv.fillStyle === "#ff00ff" && !/ff00ff|magenta/i.test(c)) throw new Error("unreadable colour " + c); cv.clearRect(0, 0, 1, 1); cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (f, b) => f.slice(0, 3).map((v, i) => v * f[3] + b[i] * (1 - f[3]));
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const svg = document.querySelector(".runmap svg.map.overlaid");
  if (!svg) return "no map";
  let ground = [255, 255, 255];
  for (let e = svg; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) { ground = over(c, ground); break; } }
  const seen = [];
  for (const t of svg.querySelectorAll("text")) {
    if (!t.textContent.trim()) continue;
    let back = ground;
    const plate = t.closest(".train")?.querySelector("rect:not(.hit)");
    if (plate) back = over(rgba(getComputedStyle(plate).fill), ground);
    let alpha = 1;
    for (let e = t; e && e !== svg.parentElement; e = e.parentElement) alpha *= parseFloat(getComputedStyle(e).opacity);
    const ink = rgba(getComputedStyle(t).fill);
    ink[3] *= alpha;
    seen.push({ said: t.textContent.trim(), dim: t.matches(".tag:not(.lit)"), lit: t.matches(".tag.lit"), r: ratio(over(ink, back), back) });
  }
  const low = seen.filter((s) => s.r < 4.5).map((s) => s.said + " " + s.r.toFixed(2));
  const dim = Math.min(...seen.filter((s) => s.dim).map((s) => s.r));
  const lit = Math.min(...seen.filter((s) => s.lit).map((s) => s.r));
  return (low.length ? "under 4.5: " + low.join(", ") : "all pass") + " | " + seen.length + " texts, " + seen.filter((s) => s.dim).length + " routes not taken" + (dim < lit ? ", quieter" : ", not quieter (" + dim.toFixed(2) + " against " + lit.toFixed(2) + ")");
}'
mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
one_lane
node -e '
const fs = require("fs");
const f = JSON.parse(fs.readFileSync(".factor/factory.json")); f.commands.verify = "true"; fs.writeFileSync(".factor/factory.json", JSON.stringify(f, null, 2));
// a summary longer than the 500 characters the record keeps: the page must not show the cut
const summary = Array.from({ length: 12 }, (_, i) => "Part " + (i + 1) + " of the work is finished and checked.").join(" ");
const script = [
  { write: { path: "FACTOR-HELLO.md", content: "Hello.\n" } }, { commit: "Say hello" },
  { handoff: { outcome: "pass", summary, claims: [{ text: "The greeting is in the file.", evidence: ["file:FACTOR-HELLO.md", "commit:HEAD", "file:README.md"] }] } },
];
fs.writeFileSync(".factor/local.json", JSON.stringify({ roles: { author: { adapter: "fake", script: { "*": script } } } }, null, 2));
'
printf -- '- [ ] First\n' > .factor/tasks.md
git add -A && git commit -q -m "a factory"
sf run > /dev/null 2>&1 # the task waits for its approval

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
section Runs
wait_for "the run is shown" "() => document.querySelector('.rundetail .visits > li')?.textContent ?? ''" 'passed'

expect "the page says whether it needs the person, in words" "$(js "() => document.querySelector('.rundetail .lede').textContent")" 'This needs you\.$'
expect "a lane's summary ends on a whole sentence" "$(js "() => document.querySelector('.visits .note').textContent")" '[.!?]$'
expect "and is not cut with dots" "$(js "() => String(/\\.\\.\\.|…/.test(document.querySelector('.visits .note').textContent))")" '^false$'
expect "the references are not on the page until asked for" "$(js "() => document.querySelectorAll('.visits .ref, .visits .claims').length")" '^0$'
expect "text is at least 15px, and nothing in the page is under 13px" "$(js "() => { const sizes = [...document.querySelectorAll('.rundetail :not(.runmap) *')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && !e.closest('.runmap')).map((e) => parseFloat(getComputedStyle(e).fontSize)); return parseFloat(getComputedStyle(document.querySelector('.visits .note')).fontSize) + ' ' + Math.min(...sizes); }")" '^(1[5-9]|2[0-9])(\.[0-9]+)? (1[3-9]|2[0-9])(\.[0-9]+)?$'
wanted_map='^all pass \| [0-9]+ texts, [1-9][0-9]* routes not taken, quieter$'
shot readable-light-1440
expect "every text of the run's map is 4.5:1 or better, and the routes not taken are quieter, in light" "$(js "$map_contrast")" "$wanted_map"
theme Dark
expect "every text of the run's map is 4.5:1 or better, and the routes not taken are quieter, in dark" "$(js "$map_contrast")" "$wanted_map"
theme Light
tab_to '^Evidence for'
pw press Enter
wait_for "the lane's evidence opens in place, with its references" "() => [...document.querySelectorAll('.visits .ref')].map((r) => r.textContent).join(' ')" '^file:FACTOR-HELLO\.md commit:HEAD file:README\.md$'
tab_to '^Gate verify passed'
pw press Enter
wait_for "and a gate's record by keyboard" "() => document.querySelector('.visits .proof .shown .output')?.textContent ?? ''" '.'
shot readable-open-light-1440
# ---- a reference opens what it names when the page can show it, and is plain text when it cannot
refs="() => [...document.querySelectorAll('.visits .ref')].map((r) => r.textContent + (r.querySelector('button') ? ' opens' : ' plain')).join(' | ')"
wait_for "a reference the page can show is a button; one it cannot is not" "$refs" '^file:FACTOR-HELLO\.md opens \| commit:HEAD opens \| file:README\.md plain$'
expect "a reference that cannot be opened does not look like a link" "$(js "() => { const s = getComputedStyle([...document.querySelectorAll('.visits .ref')].find((r) => !r.querySelector('button'))); return s.borderTopWidth + ' ' + s.textDecorationLine + ' ' + s.cursor; }")" '^0px none (auto|default)$'
back_to '^commit:HEAD$'
pw press Enter
wait_for "a commit reference opens the run's diff, in place" "() => { const p = [...document.querySelectorAll('.proof')].find((q) => q.querySelector('.what').textContent.startsWith('The diff of the whole run')); return (p?.querySelector('button').getAttribute('aria-expanded') ?? 'none') + ' ' + (p?.querySelector('.diff')?.textContent.includes('+++ b/FACTOR-HELLO.md') ?? false); }" '^true true$'
# ---- the hand-off is read as labelled lines, and its JSON is the next row
tab_to '^What it handed off'
pw press Enter
wait_for "the hand-off as labelled lines" "() => document.querySelector('.handoff')?.textContent.replace(/\\s+/g, ' ') ?? ''" '^Outcome pass Summary Part 1 of the work .*Claims The greeting is in the file\.'
expect "it is not JSON" "$(js "() => String(/[{}\\[\\]]/.test(document.querySelector('.handoff').textContent))")" '^false$'
expect "the JSON is one row away" "$(js "() => [...document.querySelectorAll('.proof')].find((p) => p.querySelector('.what').textContent === 'What it handed off').nextElementSibling.querySelector('.what').textContent")" '^Hand-off, raw JSON$'
tab_to '^Hand-off, raw JSON'
pw press Enter
wait_for "the raw hand-off" "() => [...document.querySelectorAll('.visits .output')].map((o) => o.textContent).join(' ')" 'outcome.*: .*pass'
shot readable-handoff-light-1440
# ---- a run that stops on a gate: its evidence opens on the gate that failed, the latest round first
node -e '
const fs = require("fs");
const file = ".factor/workflows/starter.json";
const w = JSON.parse(fs.readFileSync(file));
w.gates.verify.onFail = "repair";
w.gates.verify.description = "the number of tests must not go down";
w.lanes[0].limits = { repairRounds: 2 };
fs.writeFileSync(file, JSON.stringify(w, null, 2) + "\n");
const f = JSON.parse(fs.readFileSync(".factor/factory.json")); f.commands.verify = "echo the tests went down; exit 1"; fs.writeFileSync(".factor/factory.json", JSON.stringify(f, null, 2));
'
printf -- '- [ ] Second\n' >> .factor/tasks.md
git add -A && git commit -q -m "a gate that fails"
sf run > "$work/run2.log" 2>&1; [ $? -eq 1 ] || fail "the second run should stop on its gate: $(cat "$work/run2.log")"
wait_for "the stopped run is in the list" "() => [...document.querySelectorAll('.run .state')].map((m) => m.textContent).join(' | ')" '^Stopped \| Waits for you$'
back_to '^Skip to the list$'
pw press Enter
pw press ArrowUp
wait_for "the stopped run is shown" "() => document.querySelector('.rundetail h2')?.textContent ?? ''" '^Second$'
tab_to '^Evidence for Work'
pw press Enter
rows="() => [...document.querySelectorAll('.visits .shown .proof > button')].map((b) => b.querySelector('.what').textContent + (b.getAttribute('aria-expanded') === 'true' ? ' (open)' : '')).filter((t) => t.startsWith('Gate')).join(' | ')"
wait_for "the gate that failed is the first row, and is open, with what it checks in plain words" "$rows" '^Gate verify failed: the number of tests must not go down \(open\) \| '
expect "the rows are grouped by round, the latest first" "$(js "() => [...document.querySelectorAll('.visits .shown .round')].map((h) => h.textContent).join(' | ')")" '^Round 3, the latest \| Round 2 \| Round 1$'
expect "the first gate row of every round is the one that failed" "$(js "() => [...document.querySelectorAll('.visits .shown .round + .proof .what')].map((w) => w.textContent.replace(/:.*/, '')).join(' | ')")" '^Gate verify failed \| Gate verify failed \| Gate verify failed$'
expect "the lane's card does not say again what the page's sentence says" "$(js "() => { const said = document.querySelector('.rundetail header .sentence').textContent; return [...document.querySelectorAll('.visits .note')].filter((n) => said.includes(n.textContent.trim())).length + ' ' + (document.querySelector('.visits .gates-line')?.textContent ?? 'no gate line'); }")" '^0 .*verify failed$'
expect "the stop sentence says what the gate checks" "$(js "() => document.querySelector('.rundetail header').textContent")" 'That gate, verify, checks: the number of tests must not go down'
wait_for "its output is shown without another key" "() => document.querySelector('.visits .shown .proof .shown .output')?.textContent ?? ''" 'the tests went down'
js "() => { document.querySelector('.visits .proof button').scrollIntoView({ block: 'start' }); return 'scrolled'; }" > /dev/null
shot run-stopped-evidence-light-1440
pw resize 390 844
tab_to '^Stopped.*[0-9]+ Second'
pw press Enter
wait_for "the stopped run is shown in place of the list" "() => document.querySelector('.rundetail h2')?.textContent + ' ' + document.querySelectorAll('.visits .shown .round').length" '^Second 3$'
fits "a stopped run with its evidence open"
js "() => { document.querySelector('.visits .proof button').scrollIntoView({ block: 'start' }); return 'scrolled'; }" > /dev/null
shot run-stopped-evidence-light-390
pw resize 1440 900
# ---- the stopped run is tried again from its page, by keyboard
queued() { node -e 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(".factor/state.db"); console.log(db.prepare("select status from tasks where title = ?").get(process.argv[1])?.status)' "$1"; }
[ "$(queued 'Second')" = "stopped" ] || fail "the stopped run's task should be stopped: $(queued 'Second')"
expect "the terminal command stays in the text" "$(js "() => document.querySelector('.rundetail .actions')?.textContent ?? ''")" 'softwarefactor requeue [0-9a-f]+'
back_to '^Put back in the queue$'
expect "the button says what it does, and is a button" "$(js "() => document.activeElement.tagName")" '^BUTTON$'
shot run-stopped-light-1440
pw press Enter
wait_for "the page's status says the task is queued again and what starts it" "() => document.querySelector('.rundetail .lede[role=status]')?.textContent ?? ''" 'queued again: softwarefactor run starts it\.$'
expect "the command is shown as code, on the page and in the run's row" "$(js "() => document.querySelector('.rundetail .lede code')?.textContent + ' | ' + [...document.querySelectorAll('.run')].find((r) => r.textContent.includes('Second')).querySelector('.sentence code')?.textContent")" '^softwarefactor run \| softwarefactor run$'
[ "$(queued 'Second')" = "queued" ] || fail "Put back in the queue should queue the task: $(queued 'Second')"
expect "the button is not offered again while the task is queued" "$(js "() => [...document.querySelectorAll('.rundetail button')].filter((b) => /queue/i.test(b.textContent)).length")" '^0$'
expect "the keyboard goes to the page's heading, not nowhere" "$(js "$focused")" '^Second$'
shot run-stopped-queued-light-1440
theme Dark
shot readable-dark-1440
pw resize 390 844
fits "a run's page"
walk "a run's page"
shot readable-dark-390

pw close
kill "$server" 2> /dev/null
echo "readable: ok"
