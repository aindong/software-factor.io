#!/bin/bash
# The maps keep quiet unless a person is needed (round three, G1 to G3), measured in the page:
# a retry route nobody failed on is drawn about half as thick as the pass line, in the fail hue, and the
# fail colour at full weight is for a route a run took; a task badge is filled only when a person is needed
# (a working one is ground, a 1.5 px ink border, ink text); stacked badges keep clear of a route's label,
# and no badge's hit area overlaps another's or a lane's, at desk and at phone width.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/map-quiet.sh [folder for screenshots]
# Prints "map-quiet: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="quiet-$$"
server=""
slow=""
cleanup='[ -n "$slow" ] && kill "$slow" 2> /dev/null'
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
for name in $(env | sed -nE 's/^(FACTOR_[A-Za-z0-9_]*)=.*/\1/p'); do unset "$name"; done
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }
mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"

# a workflow whose Build lane has a way back (fail x2); the Plan lane holds a task while $work/hold exists
node -e '
const fs = require("fs");
const [hold] = process.argv.slice(1);
const w = { $schema: "https://softwarefactor.io/schema/workflow/v1.json", version: 1, name: "stack", description: "A way back.", roles: {}, limits: { minutes: 10, tokens: 1000 }, collectors: [{ id: "tasks", uses: "core/file@1", with: { path: ".factor/stack.md" } }],
  lanes: [
    { id: "plan", name: "Plan", uses: "core/command@1", with: { run: "if [ -f " + hold + " ]; then sleep 40; fi" }, checkpoint: "out", on: { pass: "build", fail: "@stop" } },
    { id: "build", name: "Build", uses: "core/command@1", with: { run: "true" }, checkpoint: "in", on: { pass: "@done", fail: [{ to: "plan", maxRounds: 2 }, { to: "@stop" }] } },
  ] };
fs.writeFileSync(".factor/workflows/stack.json", JSON.stringify(w, null, 2));
const f = JSON.parse(fs.readFileSync(".factor/factory.json")); f.workflow = "stack"; fs.writeFileSync(".factor/factory.json", JSON.stringify(f, null, 2));' "$work/hold"
git add -A && git commit -q -m "the stack workflow"
sf check > "$work/check.log" 2>&1 || fail "the workflow does not pass the checker: $(cat "$work/check.log")"

# styles of the map, read in the page
lines='() => { const w = (e) => parseFloat(getComputedStyle(e).strokeWidth); const pass = [...document.querySelectorAll("svg.map .line.pass:not(.to-end)")].map(w); const fail = [...document.querySelectorAll("svg.map .line.fail:not(.to-end):not(.lit)")].map(w); if (!pass.length || !fail.length) return "no lines: " + pass.length + "/" + fail.length; const p = Math.max(...pass); const f = Math.max(...fail); const hue = new Set([...document.querySelectorAll("svg.map .line.fail:not(.to-end)")].map((e) => getComputedStyle(e).stroke)); const key = getComputedStyle(document.querySelector(".legend i.fail")).backgroundColor; return (f <= p * 0.6 ? "thin" : "thick " + f + " of " + p) + " " + (hue.size === 1 && [...hue][0] !== getComputedStyle(document.querySelector("svg.map .line.pass")).stroke ? "hue" : "no hue"); }'
# a route a run took has the full weight: a fail line given the class of a lit one, as the run's map gives it
taken='() => { const l = document.querySelector("svg.map .line.fail:not(.to-end)"); l.classList.add("lit"); const w = parseFloat(getComputedStyle(l).strokeWidth); l.classList.remove("lit"); return w >= 6 ? "full" : "thin " + w; }'
badges='() => { const css = (e) => getComputedStyle(e); const ground = css(document.body).backgroundColor; const ink = css(document.querySelector("svg.map .station .name")).fill; const signal = css(document.querySelector(".legend i.asks")).backgroundColor; const out = []; for (const g of document.querySelectorAll("svg.map g.train")) { const r = css(g.querySelector("rect:not(.hit)")); const t = css(g.querySelector("text")); const asks = g.classList.contains("asks"); const [fill, text] = asks ? [signal, null] : [ground, ink]; if (r.fill !== fill) out.push((asks ? "asks" : "quiet") + " fill " + r.fill + " not " + fill); if (!asks) { if (r.stroke !== ink || parseFloat(r.strokeWidth) !== 1.5) out.push("quiet border " + r.stroke + " " + r.strokeWidth); if (t.fill !== text) out.push("quiet text " + t.fill); } } return out.length ? out.join("; ") : "as asked"; }'
# stacked badges clear of the labels of the routes (4 px), and no badge hit area over another's or over a lane's
overlap='() => { const out = []; const tags = [...document.querySelectorAll("svg.map text.tag")].map((t) => [t.textContent, t.getBoundingClientRect()]); const trains = [...document.querySelectorAll("svg.map g.train")]; const hits = [...document.querySelectorAll("svg.map .hit")].map((e) => [e, e.getBoundingClientRect()]); const meet = (a, b, m) => a.left < b.right + m && b.left < a.right + m && a.top < b.bottom + m && b.top < a.bottom + m; for (const g of trains) { const v = g.querySelector("rect:not(.hit)").getBoundingClientRect(); for (const [t, r] of tags) if (meet(v, r, 4)) out.push("badge " + g.textContent + " on [" + t + "]"); } for (const [i, [a, ra]] of hits.entries()) for (const [b, rb] of hits.slice(i + 1)) { if (!a.closest(".train") && !b.closest(".train")) continue; if (a.closest(".train") === b.closest(".train") && a.closest(".train")) continue; if (meet(ra, rb, -0.5)) out.push((a.closest(".train")?.textContent ?? "lane") + " and " + (b.closest(".train")?.textContent ?? "lane") + " " + Math.round(Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)) + "x" + Math.round(Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top))); } return out.length ? out.join("; ") : "clear"; }'

# three tasks wait at Build for approval, one is at Plan, working
printf -- "- [ ] First chore\n- [ ] Second chore\n- [ ] Third chore\n" > .factor/stack.md
git add -A && git commit -q -m "tasks"
for _ in 1 2 3; do sf run > "$work/run.log" 2>&1; [ $? -eq 3 ] || fail "a run should wait for a person: $(cat "$work/run.log")"; done

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
wait_for "the workflow is drawn" "() => document.querySelectorAll('.station.lane').length" '^2$'
wait_for "three runs wait as badges" "() => document.querySelectorAll('g.train.asks').length" '^3$'
expect "G1 idle routes: a fail route that nobody failed on is thin, in the fail hue" "$(js "$lines")" '^thin hue$'
expect "G1: a route a run took keeps the full weight" "$(js "$taken")" '^full$'
shot floor-light-1440
expect "G3 at 1440: stacked badges clear of the labels, hit areas apart" "$(js "$overlap")" '^clear$'
theme Dark
shot floor-dark-1440
theme Light
pw resize 390 844
wait_for "the map is drawn at phone width" "() => document.querySelectorAll('.station.lane').length" '^2$'
expect "G3 at 390: stacked badges clear of the labels, hit areas apart" "$(js "$overlap")" '^clear$'
shot floor-light-390
theme Dark
shot floor-dark-390
theme Light
pw resize 1440 900

# one more task, working at Plan: its badge is quiet, the three that wait are yellow
touch "$work/hold"
echo "- [ ] Fourth chore" >> .factor/stack.md
git add -A && git commit -q -m "a fourth task"
sf run > "$work/slow.log" 2>&1 &
slow=$!
wait_for "the working run is a badge" "() => document.querySelectorAll('g.train').length" '^4$'
wait_for "a badge is quiet" "() => document.querySelectorAll('g.train.working').length" '^1$'
expect "G2: a badge is filled only when a person is needed" "$(js "$badges")" '^as asked$'
expect "G3 with a working run at 1440" "$(js "$overlap")" '^clear$'
shot floor-after-run-light-1440
theme Dark
expect "G2 in the dark theme" "$(js "$badges")" '^as asked$'
shot floor-after-run-dark-1440
theme Light
pw resize 390 844
wait_for "the map is drawn at phone width" "() => document.querySelectorAll('g.train').length" '^4$'
expect "G2 at 390" "$(js "$badges")" '^as asked$'
expect "G3 with a working run at 390" "$(js "$overlap")" '^clear$'
shot floor-after-run-light-390
pw resize 1440 900

# a run's own map: the same
section Runs
wait_for "the run's map is drawn" "() => document.querySelectorAll('svg.map.overlaid .station').length" '^[1-9]'
expect "G1 on a run's map: a route nobody failed on is thin" "$(js "$lines")" '^thin hue$'

kill "$slow" 2> /dev/null
slow=""
playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "map-quiet: ok"
