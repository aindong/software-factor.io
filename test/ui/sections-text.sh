#!/bin/bash
# Running text on Plugins is at most about 75 characters wide (the text, not the tables), and on Accounts
# the command `softwarefactor account add ...` stands in a block of its own and does not wrap mid-command
# at 1440. Measured in the page, by keyboard to each section, with screenshots.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/sections-text.sh [folder for screenshots]
# Prints "sections-text: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="sections-text-$$"
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
start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900

# the widest line of running text, in characters (the width of a "0" of its own face): paragraphs and table cells
widest='() => {
  let worst = 0, which = "";
  for (const e of document.querySelectorAll(".page p, .page td")) {
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;width:1ch";
    e.appendChild(probe);
    const ch = probe.getBoundingClientRect().width;
    probe.remove();
    const r = document.createRange();
    r.selectNodeContents(e);
    const w = Math.max(0, ...[...r.getClientRects()].map((q) => q.width));
    const chars = w / ch;
    if (chars > worst) { worst = chars; which = e.textContent.slice(0, 30); }
  }
  return Math.round(worst) + " " + which;
}'

section Plugins
wait_for "plugins are listed" "() => document.querySelectorAll('.page .names li').length > 0 ? 'yes' : 'no'" '^yes$'
wait_for "the workflows are listed" "() => document.querySelectorAll('.page td').length > 0 ? 'yes' : 'no'" '^yes$'
expect "no running text on Plugins is wider than 75 characters (at 1440)" "$(js "() => Number(($widest)().split(' ')[0]) <= 76 ? 'ok' : ($widest)()")" '^ok$'
shot plugins-light-1440
theme Dark
shot plugins-dark-1440
theme Light
pw resize 390 844
sleep 0.4
fits "Plugins"
shot plugins-light-390
pw resize 1440 900
sleep 0.4

section Accounts
wait_for "Accounts is on show" "() => document.querySelector('h1').textContent" '^Accounts$'
cmd='() => [...document.querySelectorAll(".page code")].find((c) => c.textContent.startsWith("softwarefactor account add"))'
expect "the command is there" "$(js "() => (${cmd})() ? 'yes' : 'no'")" '^yes$'
expect "the command stands in a block of its own" "$(js "() => getComputedStyle((${cmd})()).display")" '^block$'
expect "and is on one line at 1440" "$(js "() => { const c = (${cmd})(); const r = document.createRange(); r.selectNodeContents(c); return new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size; }")" '^1$'
shot accounts-light-1440
theme Dark
shot accounts-dark-1440
theme Light
pw resize 390 844
sleep 0.4
fits "Accounts"
shot accounts-light-390

playwright-cli -s="$session" console error > "$work/console.log" 2>&1
grep -E "^\[ERROR\]" "$work/console.log" > "$work/errors.log"
[ -s "$work/errors.log" ] && fail "the page logged an error: $(cat "$work/errors.log")"
playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "sections-text: ok"
