#!/bin/bash
# The list of runs puts what needs a person first, in a real browser, by keyboard, measured in the page:
# waits for you, then working, then done; the waiting row carries a 3 px signal bar and its text in bold; the
# task number in a row is a quiet chip (ground fill, 1.5 px ink border, ink text); after choosing Runs the
# keyboard is on the selected row so the arrow keys work at once (the Inbox keeps the keyboard on its heading);
# at 390 the filter stays on one row with no sideways scroll of the page; the Replay slider's track is 3 to 1
# against its ground in both themes. The page is only read.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/runs-first.sh [folder for screenshots]
# Prints "runs-first: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="runsfirst-$$"
server=""
slow=""
cleanup='[ -n "$slow" ] && kill "$slow" 2> /dev/null'
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }

# ---- a workspace: build, then review, then ship on approval; the reviewer's script is set before each run
mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
cat > .factor/workflows/delivery.json << 'FLOW'
{
  "$schema": "https://softwarefactor.io/schema/workflow/v1.json",
  "version": 1,
  "name": "delivery",
  "description": "Build, review and ship on approval.",
  "roles": { "author": { "description": "Writes." }, "reviewer": { "description": "Reads." } },
  "limits": { "minutes": 60, "tokens": 1000000 },
  "commands": { "verify": { "description": "The tests." } },
  "collectors": [{ "id": "tasks", "uses": "core/file@1", "with": { "path": ".factor/tasks.md" } }],
  "gates": { "verify": { "uses": "core/command@1", "with": { "command": "verify" }, "onFail": "fail" } },
  "lanes": [
    { "id": "build", "name": "Build", "uses": "core/agent@1", "agent": { "role": "author", "access": "write", "prompt": "Build it." }, "gates": ["verify"], "checkpoint": "out", "on": { "pass": "review", "fail": "@stop" } },
    { "id": "review", "name": "Review", "uses": "core/agent@1", "agent": { "role": "reviewer", "access": "read", "prompt": "Review it." }, "checkpoint": "out", "on": { "pass": "ship", "fail": "@stop" } },
    { "id": "ship", "name": "Ship it", "uses": "core/command@1", "with": { "run": "true" }, "checkpoint": "in", "on": { "pass": "@done", "fail": "@stop" } }
  ]
}
FLOW
rm -f .factor/workflows/starter.json
node -e '
const fs = require("fs");
const f = JSON.parse(fs.readFileSync(".factor/factory.json"));
fs.writeFileSync(".factor/factory.json", JSON.stringify({ ...f, workflow: "delivery", commands: { verify: "true" } }, null, 2));
fs.writeFileSync(".factor/tasks.md", "- [ ] Add an export button\n- [ ] Fix the date format\n- [ ] Show the cost of each lane\n");
'
script() { # script <milliseconds the reviewer works>
  node -e '
const [ms] = process.argv.slice(1);
const roles = {
  author: { adapter: "fake", script: { build: [{ write: { path: "src/a.ts", content: "export {};\n" } }, { commit: "Add a" }, { handoff: { outcome: "pass", summary: "Built." } }] } },
  reviewer: { adapter: "fake", script: { review: [...(Number(ms) ? [{ sleep: Number(ms) }] : []), { handoff: { outcome: "pass", summary: "Read it." } }] } },
};
require("fs").writeFileSync(".factor/local.json", JSON.stringify({ roles }, null, 2));
' "$1"
  git add -A && git commit -q -m "set up the factory" > /dev/null 2>&1
}

# ---- one run done, one that waits for approval, then one that works
script 0
sf run > "$work/run1.log" 2>&1; [ $? -eq 3 ] || fail "the first run should wait for approval: $(cat "$work/run1.log")"
first=$(sf runs 2> /dev/null | awk 'NR == 1 { print $1 }')
[ -n "$first" ] || fail "no run id in: $(sf runs 2>&1)"
sf approve "$first" > "$work/approve.log" 2>&1 || fail "approve: $(cat "$work/approve.log")"
sf run > "$work/run2.log" 2>&1; [ $? -eq 3 ] || fail "the second run should wait for approval: $(cat "$work/run2.log")"
script 600000 # long enough that every step below happens while it works; it is killed at the end
sf run > "$work/run3.log" 2>&1 &
slow=$!

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
rows='() => [...document.querySelectorAll(".run .state")].map((m) => m.textContent).join(" | ")'
active='() => { const a = document.activeElement; return (a?.getAttribute("role") ?? a?.tagName) + ":" + (a?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60); }'

# ---- G12: after choosing Runs the keyboard is on the selected row, and the arrow keys work at once
section Runs
wait_for "the list shows its runs" "$rows" 'Done'
wait_for "the keyboard is on the selected row" "() => document.activeElement.getAttribute('role') === 'option' && document.activeElement.getAttribute('aria-selected')" '^true$'
pw press ArrowDown
expect "an arrow key moves from the row at once" "$(js "() => document.activeElement.getAttribute('role') + ' ' + document.activeElement.getAttribute('aria-selected')")" '^option true$'
pw press ArrowUp

# ---- G10: waits for you first, then working, then done
expect "the runs wait for you, then work, then are done" "$(js "$rows")" '^Waits for you \| Working \| Done$'
expect "the first row is the one that waits" "$(js "() => document.querySelector('.run').textContent")" 'Fix the date format'
expect "the waiting row has a 3 px signal bar on its left edge" "$(js "() => { const b = getComputedStyle(document.querySelector('.run[data-mark=asked]'), '::before'); const p = document.createElement('i'); p.style.color = 'var(--signal)'; document.body.append(p); const signal = getComputedStyle(p).color; p.remove(); return b.width + ' ' + (b.backgroundColor === signal) + ' ' + b.left; }")" '^3px true 0px$'
expect "no other row has the bar" "$(js "() => [...document.querySelectorAll('.run:not([data-mark=asked])')].map((r) => getComputedStyle(r, '::before').content).join()")" '^(none,?)+$'
expect "the waiting row's text is bold" "$(js "() => Number(getComputedStyle(document.querySelector('.run[data-mark=asked] .task')).fontWeight) >= 600")" '^true$'
[ -n "$shots" ] && pw screenshot --filename="$shots/runs-mixed-light-1440.png"

# ---- G11: the task number is a quiet chip
expect "the chip has the ground as its fill, an ink border and ink text" "$(js "() => { const bg = getComputedStyle(document.body).backgroundColor; const ink = getComputedStyle(document.querySelector('.run .task')).color; return [...document.querySelectorAll('.run .number')].map((n) => { const s = getComputedStyle(n); return (s.backgroundColor === bg) + ' ' + s.borderTopWidth + ' ' + (s.borderTopColor === s.color) + ' ' + (s.color === getComputedStyle(document.body).color); }).join(' | '); }")" '^(true 1(\.5)?px true true( \| )?)+$'

# ---- the Inbox keeps its safety rule: on arrival nothing is chosen for the person, the keyboard is on the heading
section Inbox
wait_for "the keyboard is on the Inbox's heading, on no item" "() => document.activeElement.tagName + ' ' + document.activeElement.textContent.trim()" '^H1 Inbox'

# ---- G14: the Replay slider's track against its ground, in both themes
section Runs
tab_to 'Waits for you.*Fix the date'
pw press Enter
wait_for "the run's page" "() => document.querySelector('.scrub input') ? 'there' : 'no'" '^there$'
# the browser does not give the colour of a slider's track as computed style: the rule's own value is resolved in the scrub's context
ratio='(() => { const i = document.querySelector(".scrub input"); const s = i.closest(".scrub"); const rule = [...document.styleSheets].flatMap((sh) => [...sh.cssRules]).find((r) => r.selectorText?.includes("::-webkit-slider-runnable-track")); if (!rule) return 0; const probe = document.createElement("i"); probe.style.background = rule.style.background; s.append(probe); const track = getComputedStyle(probe).backgroundColor; probe.remove(); const y = (c) => { const x = document.createElement("canvas").getContext("2d"); x.fillStyle = c; x.fillRect(0, 0, 1, 1); const [r, g, b] = [...x.getImageData(0, 0, 1, 1).data].slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }; const [a, b] = [y(track), y(getComputedStyle(s).backgroundColor)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); })()'
expect "the track is 3 to 1 in the light theme" "$(js "() => { const r = $ratio; return r >= 3 ? 'ok' : 'low ' + r.toFixed(2); }")" '^ok$'
[ -n "$shots" ] && pw screenshot --filename="$shots/run-light-1440.png"
theme Dark
wait_for "the track is 3 to 1 in the dark theme" "() => { const r = $ratio; return r >= 3 ? 'ok' : 'low ' + r.toFixed(2); }" '^ok$'
[ -n "$shots" ] && pw screenshot --filename="$shots/run-dark-1440.png"
theme Light

# ---- G13: at 390 the filter stays on one row and the page does not scroll sideways
pw goto "${address%%/#*}/runs"
pw resize 390 844
wait_for "the filter" "() => document.querySelectorAll('.runfilter button').length" '^[1-9]'
expect "all the filter's buttons are on one row" "$(js "() => new Set([...document.querySelectorAll('.runfilter button')].map((b) => Math.round(b.getBoundingClientRect().top))).size")" '^1$'
expect "the strip scrolls inside itself" "$(js "() => getComputedStyle(document.querySelector('.runfilter')).overflowX")" '^(auto|scroll)$'
narrow "the runs"
[ -n "$shots" ] && pw screenshot --filename="$shots/runs-mixed-light-390.png"
theme Dark
[ -n "$shots" ] && pw screenshot --filename="$shots/runs-mixed-dark-390.png"
theme Light

playwright-cli -s="$session" console error > "$work/console.log" 2>&1
grep -Eq "^\[ERROR\]|Error:" "$work/console.log" && fail "the page logged an error: $(cat "$work/console.log")"
playwright-cli -s="$session" close > /dev/null 2>&1
kill "$slow" 2> /dev/null
kill "$server" 2> /dev/null
echo "runs-first: ok"
