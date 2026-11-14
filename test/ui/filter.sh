#!/bin/bash
# The state of a run and the filter of the Runs list, in a real browser, by keyboard only: every
# row says its state in a word on its first line; the filter is chosen with Tab and Enter, kept
# in the address across a reload, honest about its count, plain when it leaves nothing, and a
# run that is open stays open when it no longer matches. The page is only read.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/filter.sh [folder for screenshots]
# Prints "filter: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="filter-$$"
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
section Runs
rows='() => [...document.querySelectorAll(".run .state")].map((m) => m.textContent).join(" | ")'
pressed='[...document.querySelectorAll(".runfilter [aria-pressed=true]")].map((b) => b.textContent).join("|")'
chosen="() => $pressed"
where='() => location.pathname + location.search'
wait_for "a run that works, one that waits and one that is done" "$rows" '^Waits for you \| Working \| Done$'

# ---- 1. every row says its state in a word, first, in the same place
expect "the first line of each row is its state" "$(js "() => [...document.querySelectorAll('.run')].map((r) => r.firstElementChild.className + ':' + r.firstElementChild.textContent).join(' | ')")" '^state:Waits for you \| state:Working \| state:Done$'
expect "the state is as far left on one row as on the next" "$(js "() => new Set([...document.querySelectorAll('.run .state')].map((s) => Math.round(s.getBoundingClientRect().left))).size")" '^1$'
expect "a row does not say its state twice" "$(js "() => [...document.querySelectorAll('.run')].map((r) => r.querySelector('.sentence')?.textContent ?? '').join(' | ')")" '^Ship it waits for your approval before it runs\. \| Review: .* \| $'
expect "a page says it with the same word and mark" "$(js "() => document.querySelector('.rundetail .state').outerHTML === document.querySelector('.run .state').outerHTML")" '^true$'
expect "the list says how its rows move, in the Floor's way of writing keys" "$(js "() => document.querySelector('.runlist .keyhint')?.textContent.trim() ?? 'no hint'")" '^↑ ↓ move between runs, Enter opens$'
expect "the keys are written as keys" "$(js "() => [...document.querySelectorAll('.runlist .keyhint kbd')].map((k) => k.textContent).join(' ')")" '^↑ ↓ Enter$'
[ -n "$shots" ] && pw screenshot --filename="$shots/filter-all-light-1440.png"

# ---- 2. the filter: All and each state that has a run, with its count
expect "the filter offers All and the states that have a run" "$(js "() => [...document.querySelectorAll('.runfilter button')].map((b) => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(' | ')")" '^All 3\* \| Working 1 \| Waits for you 1 \| Done 1$'
expect "the heading counts" "$(js "() => document.querySelector('.topbar .where span').textContent")" '^1 waits for you, 1 working, 3 shown$'
tab_to '^Working 1$'
expect "the focus ring is drawn" "$(js "() => getComputedStyle(document.activeElement).outlineStyle")" '^(solid|auto)$'
pw press Enter
wait_for "only what works" "$rows" '^Working$'
expect "the heading's count stays true" "$(js "() => document.querySelector('.topbar .where span').textContent")" '^1 waits for you, 1 working, 1 shown of 3$'
expect "the chosen filter says so" "$(js "$chosen")" '^Working 1$'
expect "the address keeps it" "$(js "$where")" '^/runs\?show=working$'
[ -n "$shots" ] && pw screenshot --filename="$shots/filter-working-light-1440.png"
pw reload
wait_for "after a reload the filter is kept" "() => $pressed + ' ' + document.querySelectorAll('.run').length" '^Working 1 1$'

# ---- 3. the list's keys keep working inside the filter
tab_to '^Working.*[a-z][0-9]+ [A-Z]'
pw press ArrowDown
expect "the arrow keys stay among the rows shown" "$(js "() => document.querySelectorAll('.run').length + ' ' + document.activeElement.getAttribute('role')")" '^1 option$'
pw press Enter
wait_for "Enter goes into the run, and the address keeps the filter" "() => location.pathname.replace(/[0-9a-f]{8}/, 'RUN') + location.search" '^/runs/RUN\?show=working$'

# ---- 4. the run that is open is not yanked away when the filter no longer matches it
tab_to '^Done 1$'
pw press Enter
wait_for "the list shows the done run" "$rows" '^Done$'
expect "the run that was open is still open" "$(js "() => document.querySelector('.rundetail .state').textContent + ' ' + document.querySelector('.rundetail h2').textContent")" '^Working '
expect "the list says it does not hold it" "$(js "() => document.querySelector('.listnote')?.textContent ?? 'no note'")" 'open run is not among those shown'
expect "no row claims to be the open one" "$(js "() => document.querySelectorAll('.run[aria-selected=true]').length")" '^0$'
expect "a row can still be reached with Tab" "$(js "() => document.querySelectorAll('.run[tabindex=\"0\"]').length")" '^1$'
[ -n "$shots" ] && pw screenshot --filename="$shots/filter-open-elsewhere-light-1440.png"

# ---- 5. the filter leaves nothing: plainly said, with the way back
pw goto "${address%%/#*}/runs?show=dropped"
wait_for "an empty result says so" "() => document.querySelector('.runlist .plain')?.textContent ?? ''" 'No run is dropped\.'
expect "the chosen filter stays on offer, with no run" "$(js "$chosen")" '^Dropped 0$'
expect "the heading counts none" "$(js "() => document.querySelector('.topbar .where span').textContent")" '0 shown of 3$'
[ -n "$shots" ] && pw screenshot --filename="$shots/filter-empty-light-1440.png"
tab_to '^Show all runs$'
pw press Enter
wait_for "the way back leads to All" "() => document.querySelectorAll('.run').length + ' ' + location.search + '.'" '^3 \.$'

# ---- 6. phone width, dark: the filter wraps and the page does not scroll sideways
pw resize 390 844
fits "the runs"
walk "the runs"
expect "the hint about the arrow keys is not shown at phone width" "$(js "() => { const h = document.querySelector('.runlist .keyhint'); return h && h.getClientRects().length > 0 ? 'shown' : 'hidden'; }")" '^hidden$'
expect "the filter's buttons are 44 px high at phone width" "$(js "() => Math.min(...[...document.querySelectorAll('.runfilter button')].map((b) => b.getBoundingClientRect().height))")" '^(4[4-9]|[5-9][0-9])(\.[0-9]+)?$'
[ -n "$shots" ] && pw screenshot --filename="$shots/filter-all-light-390.png"
tab_to '^Waits for you 1$'
pw press Enter
wait_for "the filter at phone width" "$rows" '^Waits for you$'
fits "the filtered runs"
theme Dark
[ -n "$shots" ] && pw screenshot --filename="$shots/filter-waits-dark-390.png"
theme Light

playwright-cli -s="$session" console error > "$work/console.log" 2>&1
grep -Eq "^\[ERROR\]|Error:" "$work/console.log" && fail "the page logged an error: $(cat "$work/console.log")"
playwright-cli -s="$session" close > /dev/null 2>&1
kill "$slow" 2> /dev/null
kill "$server" 2> /dev/null
echo "filter: ok"
