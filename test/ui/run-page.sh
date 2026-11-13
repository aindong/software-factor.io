#!/bin/bash
# The page of one run, in a real browser, by keyboard: a run that stopped on a gate opens on its
# failure (the lane's evidence and the gate's output are open on arrival); a run that a person
# stopped does not read "failed" anywhere; a run that waits says once that it needs a person;
# what is opened near the bottom of the page is brought into view; every gate's record in a
# lane's evidence has its mark. The page is only read (the stop is from the terminal).
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/run-page.sh [folder for screenshots]
# Prints "run-page: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="runpage-$$"
server=""
slow=""
cleanup='[ -n "$slow" ] && kill "$slow" 2> /dev/null'
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }

# ---- a workspace: one lane, built by a scripted author, judged by a gate that prints and one that counts tests
mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
cat > .factor/workflows/delivery.json << 'FLOW'
{
  "$schema": "https://softwarefactor.io/schema/workflow/v1.json",
  "version": 1,
  "name": "delivery",
  "description": "Build, check, and wait for approval.",
  "roles": { "author": { "description": "Writes." } },
  "limits": { "minutes": 60, "tokens": 1000000 },
  "commands": { "verify": { "description": "The tests." } },
  "collectors": [{ "id": "tasks", "uses": "core/file@1", "with": { "path": ".factor/tasks.md" } }],
  "gates": {
    "verify": { "uses": "core/command@1", "with": { "command": "verify" }, "description": "The tests pass.", "onFail": "fail" },
    "floor": { "uses": "core/test-floor@1", "with": { "command": "verify" }, "onFail": "fail" }
  },
  "lanes": [
    { "id": "build", "name": "Build", "uses": "core/agent@1", "agent": { "role": "author", "access": "write", "prompt": "Build it." }, "gates": ["verify", "floor"], "checkpoint": "out", "on": { "pass": "ship", "fail": "@stop" } },
    { "id": "ship", "name": "Ship it", "uses": "core/command@1", "with": { "run": "true" }, "checkpoint": "in", "on": { "pass": "@done", "fail": "@stop" } }
  ]
}
FLOW
rm -f .factor/workflows/starter.json
node -e '
const fs = require("fs");
const f = JSON.parse(fs.readFileSync(".factor/factory.json"));
fs.writeFileSync(".factor/factory.json", JSON.stringify({ ...f, workflow: "delivery", commands: { verify: "true" } }, null, 2));
fs.writeFileSync(".factor/tasks.md", "- [ ] Add an export button\n- [ ] Fix the date format\n- [ ] Slow task\n");
'
setup() { # setup <what verify runs> <milliseconds the author works>
  node -e '
const fs = require("fs");
const [verify, ms] = process.argv.slice(1);
const f = JSON.parse(fs.readFileSync(".factor/factory.json"));
fs.writeFileSync(".factor/factory.json", JSON.stringify({ ...f, commands: { verify } }, null, 2));
const build = [...(Number(ms) ? [{ sleep: Number(ms) }] : []), { write: { path: "src/a.ts", content: "export {};\n" } }, { commit: "Add a" }, { handoff: { outcome: "pass", summary: "Built it." } }];
fs.writeFileSync(".factor/local.json", JSON.stringify({ roles: { author: { adapter: "fake", script: { build } } } }, null, 2));
' "$1" "$2"
  git add -A && git commit -q -m "set up the factory" > /dev/null 2>&1
}

# ---- three runs: one that waits for approval, one that stopped on a gate, one that a person stopped
setup "echo 'Tests  3 passed (3)'" 0
sf run > "$work/run1.log" 2>&1; [ $? -eq 3 ] || fail "the first run should wait for approval: $(cat "$work/run1.log")"
setup "echo 'Tests  3 passed (3)'; echo 'FAIL date format: expected 2 got 3'; exit 1" 0
sf run > "$work/run2.log" 2>&1; [ $? -eq 1 ] || fail "the second run should stop on its gate: $(cat "$work/run2.log")"
setup "echo 'Tests  3 passed (3)'" 120000
sf run > "$work/run3.log" 2>&1 &
slow=$!
for _ in $(seq 1 100); do [ "$(sf runs 2> /dev/null | grep -c running)" -ge 1 ] && break; sleep 0.2; done
third=$(sf runs 2> /dev/null | awk 'NR == 1 { print $1 }')
[ -n "$third" ] || fail "no run id in: $(sf runs 2>&1)"
sleep 2
sf stop "$third" > "$work/stop.log" 2>&1 || fail "stop: $(cat "$work/stop.log")"
wait "$slow" 2> /dev/null
slow=""

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
section Runs
wait_for "the list shows the three runs, newest first" "$tasks" '^Slow task \| Fix the date format \| Add an export button$'
back_to '^Skip to the list$'
pw press Enter
pw press Home

# ---- 1. a run that stopped on a gate opens on its failure
pw press ArrowDown
wait_for "the page follows" "() => document.querySelector('.rundetail h2').textContent" '^Fix the date format$'
pw press Enter
expect "the page says it stopped on a gate" "$(js "() => document.querySelector('.rundetail header').innerText")" 'verify'
wait_for "the failing lane's evidence is open on arrival, with no other key" "() => [...document.querySelectorAll('.rundetail .proof > button')].find((b) => /^Evidence for/.test(b.textContent))?.getAttribute('aria-expanded') ?? 'none'" '^true$'
wait_for "the failed gate's output is on the page" "() => document.querySelector('.rundetail pre.output')?.textContent ?? 'none'" 'FAIL date format: expected 2 got 3'
expect "it is the failed gate that is open" "$(js "() => [...document.querySelectorAll('.rundetail .proof > button[aria-expanded=true] .what')].map((w) => w.textContent).join(' | ')")" 'Gate verify failed'
shot run-stopped-light-1440
pw resize 390 844
shot run-stopped-light-390
pw resize 1440 900

# ---- 2. a run that a person stopped does not read "failed"
back_to '^Fix the date format'
pw press ArrowUp
wait_for "the page follows" "() => document.querySelector('.rundetail h2').textContent" '^Slow task$'
expect "its first sentence says a person stopped it" "$(js "() => document.querySelector('.rundetail header').innerText")" 'Stopped by a person'
expect "the lane that was working says Stopped, with the neutral mark" "$(js "() => [...document.querySelectorAll('.rundetail .visit')].map((v) => v.querySelector('.outcome').textContent + ' ' + v.querySelector('.mark').className).join(' | ')")" '^stopped mark stopped$'
expect "the replay says it too" "$(js "() => document.querySelector('.rundetail .scrub output').textContent")" 'Build stopped$'
expect "nothing on the page or in the list row says failed" "$(js "() => { const here = [document.querySelector('.rundetail'), document.querySelector('.run[aria-selected=true]')]; const said = here.flatMap((e) => [e.innerText, ...[...e.querySelectorAll('[aria-label],[title]')].flatMap((n) => [n.getAttribute('aria-label'), n.getAttribute('title')])]); return said.filter((t) => /fail/i.test(t ?? '')).join(' | ') || 'none'; }")" '^none$'
shot run-person-stopped-light-1440

# ---- 3. a run that waits says once that it needs a person, where the eye lands first
pw press ArrowDown
pw press ArrowDown
wait_for "the page follows" "() => document.querySelector('.rundetail h2').textContent" '^Add an export button$'
expect "it is said once" "$(js "() => (document.querySelector('.rundetail').innerText.match(/waits? for (your|you)|needs? (you|a person)|Needs you/gi) ?? []).length")" '^1$'
shot run-waits-light-1440

# ---- 4. what is opened near the bottom of the page is brought into view
pw resize 1440 600
tab_to '^The diff of the whole run'
pw press Enter
wait_for "the diff is open" "() => document.querySelector('.rundetail .proof > button[aria-expanded=true] .what')?.textContent ?? 'none'" 'The diff of the whole run'
wait_for "its first line is on the screen, not below the fold" "() => { const r = document.querySelector('.rundetail .proof > button[aria-expanded=true] + .shown')?.getBoundingClientRect(); return r ? String(r.top < innerHeight - 40) : 'none'; }" '^true$'
pw resize 1440 900

# ---- 5. every gate's record in a lane's evidence has its mark
back_to '^Evidence for Build'
pw press Enter
wait_for "the evidence is open" "() => document.querySelectorAll('.rundetail .proof .proof').length" '^[1-9]'
expect "the record on the base commit is there" "$(js "() => [...document.querySelectorAll('.rundetail .proof .what')].filter((w) => /on the base commit/.test(w.textContent)).length")" '^1$'
expect "every gate's row has a mark, the one on the base commit too" "$(js "() => [...document.querySelectorAll('.rundetail .proof > button')].filter((b) => /^Gate /.test(b.querySelector('.what')?.textContent ?? '') && !b.querySelector('.mark')).map((b) => b.querySelector('.what').textContent).join(' | ') || 'none'")" '^none$'

playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "run-page: ok"
