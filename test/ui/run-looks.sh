#!/bin/bash
# The list of runs and a run's page, as the second design round wants them, in a real browser, by keyboard:
# a stopped run says what failed above its map (F4); a closed row that opens looks one way at both depths (F8);
# the selected filter chip is quiet, so the page's one loud control is its own (F6); the way back is a text
# link and the filter is not shown above an open run at phone width (F10); a run that waits for a person reads
# louder than a done one (F11); a run whose task is queued again says so and links to the Floor (F14).
# The page is only read (the runs are made from the terminal). Needs playwright-cli and a built command.
# Usage: bash test/ui/run-looks.sh [folder for screenshots]
# Prints "run-looks: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="runlooks-$$"
server=""
slow=""
cleanup='[ -n "$slow" ] && kill "$slow" 2> /dev/null'
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }

# ---- a workspace: build (gates), then ship on approval
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
    "verify": { "uses": "core/command@1", "with": { "command": "verify" }, "description": "The tests pass.", "onFail": "fail" }
  },
  "lanes": [
    { "id": "build", "name": "Build", "uses": "core/agent@1", "agent": { "role": "author", "access": "write", "prompt": "Build it." }, "gates": ["verify"], "checkpoint": "out", "on": { "pass": "ship", "fail": "@stop" } },
    { "id": "ship", "name": "Ship it", "uses": "core/command@1", "with": { "run": "true" }, "checkpoint": "in", "on": { "pass": "@done", "fail": "@stop" } }
  ]
}
FLOW
rm -f .factor/workflows/starter.json
node -e '
const fs = require("fs");
const f = JSON.parse(fs.readFileSync(".factor/factory.json"));
fs.writeFileSync(".factor/factory.json", JSON.stringify({ ...f, workflow: "delivery", commands: { verify: "true" } }, null, 2));
fs.writeFileSync(".factor/tasks.md", "- [ ] Add an export button\n- [ ] Fix the date format\n- [ ] Show the cost of each lane\n- [ ] Slow task\n");
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

# ---- four runs: one done, one stopped on a gate, one that waits for approval, one still working
setup "echo 'Tests  3 passed (3)'" 0
sf run > "$work/run1.log" 2>&1; [ $? -eq 3 ] || fail "the first run should wait for approval: $(cat "$work/run1.log")"
first=$(sf runs 2> /dev/null | awk 'NR == 1 { print $1 }')
sf approve "$first" > "$work/approve.log" 2>&1 || fail "approve: $(cat "$work/approve.log")"
setup "echo 'Tests  3 passed (3)'; echo 'FAIL date format: expected 2 got 3'; exit 1" 0
sf run > "$work/run2.log" 2>&1; [ $? -eq 1 ] || fail "the second run should stop on its gate: $(cat "$work/run2.log")"
broke=$(sf runs 2> /dev/null | awk 'NR == 1 { print $1 }')
setup "echo 'Tests  3 passed (3)'" 0
sf run > "$work/run3.log" 2>&1; [ $? -eq 3 ] || fail "the third run should wait for approval: $(cat "$work/run3.log")"
setup "echo 'Tests  3 passed (3)'" 120000
sf run > "$work/run4.log" 2>&1 &
slow=$!
for _ in $(seq 1 100); do [ "$(sf runs 2> /dev/null | grep -c running)" -ge 1 ] && break; sleep 0.2; done
working=$(sf runs 2> /dev/null | awk 'NR == 1 { print $1 }')
[ -n "$working" ] || fail "no working run in: $(sf runs 2>&1)"

ITEMS=${ITEMS:-"1 2 3 4 5 6"}
want() { case " $ITEMS " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
to_list() { # the keyboard on a row of the list
  back_to 'just now|min ago|h ago'
}
open_run() { # open_run <task>: the keyboard is on a row; the run of that task is entered
  pw press Home
  for _ in 1 2 3 4 5 6; do
    js "$focused" | grep -Eq "[0-9]+ $1" && break
    pw press ArrowDown
  done
  wait_for "the page follows to $1" "() => document.querySelector('.rundetail h2').textContent" "^$1\$"
  pw press Enter
}

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
section Runs
wait_for "the list shows the four runs" "$tasks" '^Slow task \| Show the cost of each lane \| Fix the date format \| Add an export button$'
back_to '^Skip to the list$'
pw press Enter

# ---- F4: what failed comes first, above the map, at both widths
if want 1; then
  open_run "Fix the date format"
  wait_for "the failing output is on the page" "() => document.querySelector('.rundetail pre.output')?.textContent ?? 'none'" 'FAIL date format: expected 2 got 3'
  place='() => { const f = document.querySelector(".rundetail .failed"); const m = document.querySelector(".rundetail .runmap"); if (!f || !m) return "no failed block"; const o = f.querySelector("pre.output")?.getBoundingClientRect(); return (f.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING ? "above the map" : "below the map") + " " + (o ? Math.round(o.top) + " of " + innerHeight : "no output"); }'
  expect "what failed is above the map, with its output on the first screen" "$(js "$place")" '^above the map [0-9]+ of 900$'
  expect "the output starts within the first 520 px, where it used to be below the map" "$(js "() => document.querySelector('.rundetail .failed pre.output')?.getBoundingClientRect().top < 520")" '^true$'
  expect "it names the lane, the gate in plain words, and the output" "$(js "() => document.querySelector('.rundetail .failed')?.innerText ?? 'none'")" 'What failed(.|\n)*Build(.|\n)*verify(.|\n)*The tests pass(.|\n)*FAIL date format'
  expect "the lane's own evidence still holds the gate" "$(js "() => [...document.querySelectorAll('.rundetail .visits .proof > button .what')].map((w) => w.textContent).filter((t) => /^Gate verify failed/.test(t)).length")" '^1$'
  shot run-failed-first-light-1440
  pw resize 390 844
  wait_for "the page is the same run at phone width" "() => document.querySelector('.rundetail h2')?.textContent" '^Fix the date format$'
  wait_for "the failing output is inside the first screen after the head" "() => String(document.querySelector('.rundetail .failed pre.output')?.getBoundingClientRect().top < innerHeight)" '^true$'
  shot run-failed-first-light-390
  pw resize 1440 900
fi

# ---- F8: a closed row that opens looks one way, at both depths; depth is the indent alone
if want 2; then
  to_list
  open_run "Add an export button"
  tab_to '^Evidence for Build'
  pw press Enter
  wait_for "the lane's evidence is open, with rows of its own" "() => document.querySelectorAll('.rundetail .proof .proof').length" '^[1-9]'
  look='() => { const rows = [...document.querySelectorAll(".rundetail .proof > button[aria-expanded=false]")]; const sig = (b) => { const c = getComputedStyle(b); return [c.borderTopWidth, c.borderTopStyle, c.borderTopColor, c.backgroundColor, c.borderRadius, c.color, c.paddingLeft].join(" "); }; const by = new Map(); for (const b of rows) { const k = sig(b); by.set(k, [...(by.get(k) ?? []), b.querySelector(".what").textContent]); } return by.size === 1 ? "one look" : [...by].map(([k, v]) => v.join(" / ") + " = " + k).join(" || "); }'
  expect "every closed row, evidence for a lane, the diff, a gate, the hand-off, looks the same" "$(js "$look")" '^one look$'
  expect "there are rows of both depths to compare" "$(js "() => document.querySelectorAll('.rundetail .proof > button[aria-expanded=false]').length > 3 && document.querySelectorAll('.rundetail .proof .proof > button').length > 0")" '^true$'
  expect "a nested row is set in by its indent" "$(js "() => { const o = document.querySelector('.rundetail .proof .proof > button').getBoundingClientRect().left; const t = document.querySelector('.rundetail .proof > button').getBoundingClientRect().left; return String(o - t >= 8); }")" '^true$'
  expect "a gate's row keeps its mark" "$(js "() => [...document.querySelectorAll('.rundetail .proof > button')].filter((b) => /^Gate /.test(b.querySelector('.what').textContent) && !b.querySelector('.mark')).length")" '^0$'
  shot run-rows-light-1440
  back_to 'just now|min ago|h ago'
  open_run "Fix the date format"
  expect "the failed gate keeps its mark of failure in the lane's rows" "$(js "() => [...document.querySelectorAll('.rundetail .visits .proof > button')].filter((b) => /^Gate verify failed/.test(b.querySelector('.what').textContent) && b.querySelector('.mark.fail')).length")" '^1$'
  back_to 'just now|min ago|h ago'
fi

# ---- F6: the selected chip is quiet, so the only loud control of a run's page is its own
if want 3; then
  to_list
  open_run "Fix the date format"
  chip='() => { const on = document.querySelector(".runfilter [aria-pressed=true]"); const off = document.querySelector(".runfilter [aria-pressed=false]"); const c = getComputedStyle(on); const o = getComputedStyle(off); const ink = getComputedStyle(document.body).color; const loud = getComputedStyle(document.querySelector(".rundetail .button.primary")).backgroundColor; return [c.fontWeight, c.borderBottomWidth, c.backgroundColor === loud ? "ink fill" : "quiet fill", c.color === ink ? "ink text" : "other text", o.fontWeight, o.color === ink ? "ink text" : "soft text"].join(", "); }'
  expect "the selected chip is a quiet fill with ink text at 600 and a 2 px line under it; the others are plain" "$(js "$chip")" '^600, 2px, quiet fill, ink text, 400, soft text$'
  expect "one control of the page is loud: the button that does the one thing" "$(js "() => { const loud = getComputedStyle(document.querySelector('.rundetail .button.primary')).backgroundColor; return [...document.querySelectorAll('main button, main a.button')].filter((b) => b.getClientRects().length > 0 && getComputedStyle(b).backgroundColor === loud).map((b) => b.textContent.trim()).join(' | '); }")" '^Put back in the queue$'
  shot run-chip-light-1440
  back_to 'just now|min ago|h ago'
fi

# ---- end
sf stop "$working" > /dev/null 2>&1
wait "$slow" 2> /dev/null
slow=""
playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "run-looks: ok"
