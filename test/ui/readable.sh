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
theme Dark
shot readable-dark-1440
pw resize 390 844
fits "a run's page"
walk "a run's page"
shot readable-dark-390

pw close
kill "$server" 2> /dev/null
echo "readable: ok"
