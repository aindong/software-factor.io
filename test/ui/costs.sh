#!/bin/bash
# Costs: each task of the "By task" table is a link to its run, and the totals say which period they cover.
# Driven by keys and then read, at desk and at phone width. Needs playwright-cli and a built command
# (pnpm run build). Usage: bash test/ui/costs.sh [folder for screenshots]
# Prints "costs: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="costs-$$"
server=""
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
one_lane
node -e '
const fs = require("fs");
const f = JSON.parse(fs.readFileSync(".factor/factory.json")); f.commands.verify = "true"; fs.writeFileSync(".factor/factory.json", JSON.stringify(f, null, 2));
const script = [{ write: { path: "HELLO.md", content: "Hello.\n" } }, { commit: "Say hello" }, { usage: { tokens: 18400, usd: 0.31 } }, { handoff: { outcome: "pass", summary: "Said hello." } }];
fs.writeFileSync(".factor/local.json", JSON.stringify({ roles: { author: { adapter: "fake", script: { "*": script } } } }, null, 2));
'
printf -- '- [ ] Say hello\n' > .factor/tasks.md
git add -A && git commit -q -m "a factory"
sf run > /dev/null 2>&1 # the task waits for its approval, after one session of the agent

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
section Costs
wait_for "the tables" "() => [...document.querySelectorAll('.page h2')].map((h) => h.textContent).join(' | ')" '^By lane \| By task \| By account$'
expect "the totals say what period they cover" "$(js "() => document.querySelector('.topbar .where').textContent")" 'all sessions, on [A-Z][a-z]{2} [0-9]+, [0-9]{4}$'
expect "the task of the By task table is a link to its run" "$(js "() => { const a = document.querySelector('.costs a'); return a ? a.textContent.trim() + ' ' + a.getAttribute('href') : 'no link'; }")" '^Say hello /runs/[0-9a-z]+$'
expect "the total is what the eye lands on: heavier and darker than the period beside it" "$(js "() => { const [t, p] = ['.where span:not(.quiet)', '.where span.quiet'].map((q) => getComputedStyle(document.querySelector('.topbar ' + q))); return Number(t.fontWeight) > Number(p.fontWeight) && t.color !== p.color ? 'stands out' : 'same as the period: ' + t.fontWeight + ' ' + t.color; }")" '^stands out$'
expect "the cost per landed task is not a bare figure when none landed: it says so in a phrase" "$(js "() => [...document.querySelectorAll('.figures > div')].find((d) => d.querySelector('dt').textContent === 'Cost per landed task')?.querySelector('dd').textContent ?? 'no figure'")" '^none landed yet$'
links="() => { const h = [...document.querySelectorAll('.costs a')].map((a) => a.getBoundingClientRect().height); return h.length > 0 && h.every((x) => x >= LEAST - 0.5) ? 'ok' : h.map(Math.round).join(' ') + ' too short'; }"
expect "a task's link is 24 px high at least at desk width" "$(js "${links/LEAST/24}")" '^ok$'
shot costs-light-1440
theme Dark
shot costs-dark-1440
pw resize 390 844
fits "costs"
expect "a task's link is 44 px high at least at phone width" "$(js "${links/LEAST/44}")" '^ok$'
shot costs-dark-390
theme Light
shot costs-light-390
expect "the period is on the page at phone width too" "$(js "() => document.querySelector('.topbar .where').textContent")" 'all sessions'
tab_to '^Say hello$'
pw press Enter
wait_for "the link leads to the run's page" "() => document.querySelector('.rundetail h2')?.textContent ?? ''" '^Say hello$'

playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "costs: ok"
