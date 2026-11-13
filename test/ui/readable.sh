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
  { handoff: { outcome: "pass", summary, claims: [{ text: "The greeting is in the file.", evidence: ["file:FACTOR-HELLO.md", "commit:HEAD"] }] } },
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
shot readable-light-1440
tab_to '^Evidence for'
pw press Enter
wait_for "the lane's evidence opens in place, with its references" "() => [...document.querySelectorAll('.visits .ref')].map((r) => r.textContent).join(' ')" '^file:FACTOR-HELLO\.md commit:HEAD$'
tab_to '^Gate verify passed'
pw press Enter
wait_for "and a gate's record by keyboard" "() => document.querySelector('.visits .proof .shown .output')?.textContent ?? ''" '.'
shot readable-open-light-1440
# ---- a run that stops on a gate: its evidence opens on the gate that failed, the latest round first
node -e '
const fs = require("fs");
const file = ".factor/workflows/starter.json";
const w = JSON.parse(fs.readFileSync(file));
w.gates.verify.onFail = "repair";
w.gates.verify.description = "floor: the number of tests must not go down";
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
wait_for "the gate that failed is the first row, and is open, with what it checks in plain words" "$rows" '^Gate verify failed: floor: the number of tests must not go down \(open\) \| '
expect "the rows are grouped by round, the latest first" "$(js "() => [...document.querySelectorAll('.visits .shown .round')].map((h) => h.textContent).join(' | ')")" '^Round 3 \| Round 2 \| Round 1$'
expect "the first gate row of every round is the one that failed" "$(js "() => [...document.querySelectorAll('.visits .shown .round + .proof .what')].map((w) => w.textContent.replace(/:.*/, '')).join(' | ')")" '^Gate verify failed \| Gate verify failed \| Gate verify failed$'
expect "the stop sentence says what the gate checks" "$(js "() => document.querySelector('.rundetail header').textContent")" 'verify.*floor: the number of tests must not go down'
wait_for "its output is shown without another key" "() => document.querySelector('.visits .shown .proof .shown .output')?.textContent ?? ''" 'the tests went down'
shot run-stopped-evidence-light-1440
pw resize 390 844
fits "a stopped run with its evidence open"
shot run-stopped-evidence-light-390
pw resize 1440 900
# ---- the stopped run is tried again from its page, by keyboard
queued() { node -e 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(".factor/state.db"); console.log(db.prepare("select status from tasks where title = ?").get(process.argv[1])?.status)' "$1"; }
[ "$(queued 'Second')" = "stopped" ] || fail "the stopped run's task should be stopped: $(queued 'Second')"
expect "the terminal command stays in the text" "$(js "() => document.querySelector('.rundetail .actions')?.textContent ?? ''")" 'softwarefactor requeue [0-9a-f]+'
back_to '^Try again$'
expect "Try again is a button" "$(js "() => document.activeElement.tagName")" '^BUTTON$'
shot run-stopped-light-1440
pw press Enter
wait_for "the page says what happened, in its status line" "() => document.querySelector('.rundetail .lede[role=status]')?.textContent ?? ''" 'Queued again: Second\.'
[ "$(queued 'Second')" = "queued" ] || fail "Try again should put the task back in the queue: $(queued 'Second')"
expect "the keyboard goes to the page's heading, not nowhere" "$(js "$focused")" '^Second$'
tab_to '^Try again$'
pw press Enter
wait_for "a second press is refused in words, and nothing changes" "() => document.querySelector('.rundetail .lede[role=status]')?.textContent ?? ''" 'Not queued again: Second\. .*already queued'
theme Dark
shot readable-dark-1440
pw resize 390 844
fits "a run's page"
walk "a run's page"
shot readable-dark-390

pw close
kill "$server" 2> /dev/null
echo "readable: ok"
