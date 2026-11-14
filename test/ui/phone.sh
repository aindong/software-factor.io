#!/bin/bash
# Phone width and small targets on a run's page, measured in the page: at 390 no text of a run's map renders
# under 12 px (the map scrolls sideways at full size), a stopped run's map starts with the lane that failed in
# view and a waiting run's with the lane that waits, every station and task badge is 44 px high and wide at
# least, and the replay slider and a reference button are 24 px at desk width and 44 px at phone width in each
# direction. Needs playwright-cli and a built command (pnpm run build). The page is driven by keys and read.
# Usage: bash test/ui/phone.sh [folder for screenshots]
# Prints "phone: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="phone-$$"
server=""
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
for name in $(env | sed -nE 's/^(FACTOR_[A-Za-z0-9_]*)=.*/\1/p'); do unset "$name"; done
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }

# the rendered size of every text of a run's map, in pixels: its font size times how large the map is drawn
map_text='() => { const m = document.querySelector(".runmap svg.map"); if (!m) return "no map"; const k = m.getBoundingClientRect().width / m.viewBox.baseVal.width; const t = [...m.querySelectorAll("text")].filter((e) => e.textContent.trim()).map((e) => ({ said: e.textContent.trim(), px: parseFloat(getComputedStyle(e).fontSize) * k })); const low = t.filter((e) => e.px < 12 - 0.05); return low.length ? low.map((e) => e.said + " " + e.px.toFixed(1)).join(", ") + " under 12 px" : "all " + t.length + " texts at 12 px or more"; }'
# a station of the run's map is wholly inside the box the map scrolls in
in_view() { # in_view <selector of the station>
  echo "() => { const s = document.querySelector('.runmap .map-scroll $1 .hit'); if (!s) return 'no such station'; const b = document.querySelector('.runmap .map-scroll').getBoundingClientRect(); const r = s.getBoundingClientRect(); return r.left >= b.left - 0.5 && r.right <= b.right + 0.5 ? 'in view' : 'out of view: ' + Math.round(r.left) + '..' + Math.round(r.right) + ' in ' + Math.round(b.left) + '..' + Math.round(b.right); }"
}
# the size of the replay slider and of a reference button
targets() { # targets <least>
  js "() => { const t = [['replay slider', document.querySelector('.scrub input')], ['reference button', document.querySelector('.ref button')]].map(([n, e]) => { if (!e) return n + ' not found'; const r = e.getBoundingClientRect(); return r.width >= $1 - 0.5 && r.height >= $1 - 0.5 ? 'ok' : n + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); }); return t.every((x) => x === 'ok') ? 'ok' : t.filter((x) => x !== 'ok').join(', ') + ' too small'; }"
}

mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
one_lane
node -e '
const fs = require("fs");
const f = JSON.parse(fs.readFileSync(".factor/factory.json")); f.commands.verify = "true"; fs.writeFileSync(".factor/factory.json", JSON.stringify(f, null, 2));
const script = [
  { write: { path: "FACTOR-HELLO.md", content: "Hello.\n" } }, { commit: "Say hello" },
  { handoff: { outcome: "pass", summary: "Said hello.", claims: [{ text: "The greeting is in the file.", evidence: ["file:FACTOR-HELLO.md", "commit:HEAD"] }] } },
];
fs.writeFileSync(".factor/local.json", JSON.stringify({ roles: { author: { adapter: "fake", script: { "*": script } } } }, null, 2));
'
printf -- '- [ ] First\n' > .factor/tasks.md
git add -A && git commit -q -m "a factory"
sf run > /dev/null 2>&1 # the task waits for its approval
# two runs of a long line of lanes: one stops at its fifth lane, one waits there for a person
chain() { # chain <name> <fifth lane's command> <its checkpoint> <task>
  node -e '
const fs = require("fs");
const [name, run, checkpoint, task] = process.argv.slice(1);
const names = ["Collect the inputs", "Sort the requests", "Prepare the build", "Compile the sources", "Verify the release", "Publish it"];
const lanes = names.map((n, i) => ({ id: "l" + i, name: n, uses: "core/command@1", with: { run: i === 4 ? run : "true" }, checkpoint: i === 4 ? checkpoint : "out", on: { pass: i === 5 ? "@done" : "l" + (i + 1), fail: "@stop" } }));
const w = { $schema: "https://softwarefactor.io/schema/workflow/v1.json", version: 1, name, description: "A long line.", roles: {}, limits: { minutes: 10, tokens: 1000 }, collectors: [{ id: "tasks", uses: "core/file@1", with: { path: ".factor/" + name + ".md" } }], lanes };
fs.writeFileSync(".factor/workflows/" + name + ".json", JSON.stringify(w, null, 2));
fs.appendFileSync(".factor/" + name + ".md", task + "\n");
const f = JSON.parse(fs.readFileSync(".factor/factory.json")); f.workflow = name; fs.writeFileSync(".factor/factory.json", JSON.stringify(f, null, 2));' "$@"
  git add -A && git commit -q -m "a task for $1" 2> /dev/null
  node "$here/dist/cli.js" run >> "$work/chain.log" 2>&1 || true
}
chain stopper false out "- [ ] Breaks late"
chain waiter true in "- [ ] Waits late"

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
section Runs
wait_for "the runs are listed" "() => document.querySelectorAll('.run').length" '^3$'
# ---- the replay slider and a reference button, at desk width
tab_to '^Skip to the list'
pw press Enter
for _ in 1 2 3; do
  [ "$(js "() => document.querySelector('.rundetail h2')?.textContent ?? ''")" = "First" ] && break
  pw press ArrowDown
done
wait_for "the run of the agent is shown" "() => document.querySelector('.rundetail h2')?.textContent ?? ''" '^First$'
tab_to '^Evidence for'
pw press Enter
wait_for "the references are shown" "() => document.querySelectorAll('.visits .ref button').length" '^[1-9]'
expect "the replay slider and a reference button are 24 px at least in each direction at desk width" "$(targets 24)" '^ok$'
pw resize 390 844
tab_to '[0-9]+ First'
pw press Enter
wait_for "the run of the agent is shown at phone width" "() => document.querySelector('.rundetail h2')?.textContent ?? ''" '^First$'
expect "the replay slider and a reference button are 44 px at least in each direction at phone width" "$(targets 44)" '^ok$'
# ---- a stopped run, at phone width
back_to 'All runs'
pw press Enter
pw press ArrowDown # the list: the run that waits late, the run that waits at its first, then the stopped run
pw press Enter
wait_for "the stopped run's map is drawn" "() => document.querySelectorAll('.runmap svg.map.overlaid .station').length" '^[1-9]'
expect "no text of the stopped run's map renders under 12 px at 390" "$(js "$map_text")" '^all [0-9]+ texts'
expect "every station and the badge of the run's map is 44 by 44 px at least at 390" "$(hits '.runmap svg.map .station .hit, .runmap g.train .hit' 44 44)" '^ok$'
wait_for "the lane that failed is in view" "$(in_view '.station.ran-fail')" '^in view$'
wait_for "the stopped run's map says how many stations are out of sight to the right, as the Floor's does" "() => document.querySelector('.runmap .map-more')?.textContent ?? 'no cue'" '^[0-9]+ more stations? to the right$'
unpainted "the stopped run's map"
shot phone-stopped-light-390
# ---- a waiting run, at phone width
back_to 'All runs'
pw press Enter
pw press ArrowUp
pw press ArrowUp
pw press Enter
wait_for "the waiting run's map is drawn" "() => document.querySelectorAll('.runmap svg.map.overlaid .station').length" '^[1-9]'
expect "no text of the waiting run's map renders under 12 px at 390" "$(js "$map_text")" '^all [0-9]+ texts'
wait_for "the lane that waits is in view" "$(in_view '.station[aria-label*=here]')" '^in view$'
unpainted "the waiting run's map"
shot phone-waiting-light-390
pw resize 1440 900
expect "at desk width no text of the map is under 12 px either" "$(js "$map_text")" '^all [0-9]+ texts'

playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "phone: ok"
