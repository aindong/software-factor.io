#!/bin/bash
# Runs and the evidence viewer in a real browser, by keyboard: the steps of the plan's browser
# check, kept so that they can be run again. Needs playwright-cli and a built command
# (pnpm run build). The page is driven with key presses only and then read: nothing is clicked
# or focused by script.
# Usage: bash test/ui/runs.sh [folder for screenshots]
# Prints "runs: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="runs-$$"
server=""

# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
export FACTOR_HOME="$work/home" COUNT="$work/count.txt"
sf() { node "$here/dist/cli.js" "$@"; }

# ---- a workspace whose workflow builds, reviews (once sent back), checks and ships on approval
mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
cat > .factor/workflows/delivery.json << 'EOF'
{
  "$schema": "https://softwarefactor.io/schema/workflow/v1.json",
  "version": 1,
  "name": "delivery",
  "description": "Build, review, check and ship on approval.",
  "roles": { "author": { "description": "Writes." }, "reviewer": { "description": "Reads." } },
  "limits": { "minutes": 60, "tokens": 1000000 },
  "commands": { "verify": { "description": "The tests." } },
  "collectors": [{ "id": "tasks", "uses": "core/file@1", "with": { "path": ".factor/tasks.md" } }],
  "gates": { "verify": { "uses": "core/command@1", "with": { "command": "verify" }, "onFail": "fail" } },
  "lanes": [
    {
      "id": "build", "name": "Build", "uses": "core/agent@1",
      "agent": { "role": "author", "access": "write", "prompt": "Build it." },
      "gates": ["verify"], "checkpoint": "out",
      "on": { "pass": "review", "fail": "@stop" }
    },
    {
      "id": "review", "name": "Review", "uses": "core/agent@1",
      "agent": { "role": "reviewer", "access": "read", "prompt": "Review it." },
      "checkpoint": "out",
      "on": { "pass": "check", "fail": [{ "to": "build", "maxRounds": 2 }, { "to": "@stop" }] }
    },
    {
      "id": "check", "name": "Check", "uses": "core/command@1",
      "with": { "run": "n=$(cat \"$COUNT\" 2>/dev/null || echo 0); echo $((n + 1)) > \"$COUNT\"; echo \"checked $n\"; [ \"$n\" -ne 1 ]" },
      "checkpoint": "out",
      "on": { "pass": "ship", "fail": "@stop" }
    },
    {
      "id": "ship", "name": "Ship it", "uses": "core/command@1",
      "with": { "run": "true" },
      "checkpoint": "in",
      "on": { "pass": "@done", "fail": "@stop" }
    }
  ]
}
EOF
rm -f .factor/workflows/starter.json
node -e '
const fs = require("fs");
const f = JSON.parse(fs.readFileSync(".factor/factory.json"));
fs.writeFileSync(".factor/factory.json", JSON.stringify({ ...f, workflow: "delivery", commands: { verify: "true" }, gateEnv: ["COUNT"] }, null, 2));
fs.writeFileSync(".factor/tasks.md", "- [ ] Add an export button\n- [ ] Fix the date format\n- [ ] Show the cost of each lane\n");
'

start_ui 0
pw open "$address" || fail "the browser did not open"
grep -q "Console: [1-9]" "$work/pw.log" && fail "the page logged an error: $(cat "$work/pw.log")"
pw resize 1440 900

# ---- a recording and two screenshots for the scripted agent to attach: of this very page
pw video-start "$work/recording.webm"
pw press Tab && pw press Tab && sleep 0.6
pw screenshot --filename="$work/before.png"
section Runs
wait_for "Runs opens with nothing run yet" "() => document.querySelector('.plain')?.textContent ?? ''" 'No task has run yet'
shot runs-empty-light-1440
sleep 0.6
pw screenshot --filename="$work/after.png"
pw video-stop
[ -s "$work/recording.webm" ] || fail "no recording was made"
node -e '
const fs = require("fs");
const b64 = (f) => fs.readFileSync(process.argv[1] + "/" + f).toString("base64");
const attach = (name, file) => ({ attach: { name, content: b64(file), base64: true } });
const build = (file, summary) => [
  { write: { path: file, content: "export const label = \"Export\";\n" } },
  { commit: "Add " + file },
  attach("before.png", "before.png"), attach("after.png", "after.png"), attach("walkthrough.webm", "recording.webm"),
  { attach: { name: "notes.txt", content: "Checked at 1440 and 390 wide.\n" } },
  { usage: { tokens: 18400, usd: 0.31 } },
  { handoff: { outcome: "pass", summary, claims: [
    { text: "The button is on the list page.", evidence: ["file:" + file, "commit:HEAD"] },
    { text: "The page before and after the change.", evidence: ["attached:before.png", "attached:after.png"] },
    { text: "A walk through the new flow.", evidence: ["attached:walkthrough.webm"] },
    { text: "Both widths were checked.", evidence: ["attached:notes.txt"] },
  ] } },
];
const roles = {
  author: { adapter: "fake", script: { build: [build("src/export.ts", "Added the export button."), build("src/export.test.ts", "Added the missing test.")] } },
  reviewer: { adapter: "fake", script: { review: [
    [{ usage: { tokens: 6100, usd: 0.09 } }, { handoff: { outcome: "fail", summary: "The empty list has no test." } }],
    [{ usage: { tokens: 5200, usd: 0.08 } }, { handoff: { outcome: "pass", summary: "Read the change. The test is there." } }],
  ] } },
};
fs.writeFileSync(".factor/local.json", JSON.stringify({ roles }, null, 2));
' "$work"
git add -A && git commit -q -m "set up the factory"

# ---- two runs while the page is open: they appear without a reload
js "() => { window.stayed = 'yes'; return 'marked'; }" > /dev/null
sf run > "$work/run1.log" 2>&1; [ $? -eq 3 ] || fail "the first run should wait for approval: $(cat "$work/run1.log")"
wait_for "a run started while the page is open appears" "() => document.querySelectorAll('.run').length + ' ' + window.stayed" '^1 yes$'
first=$(js "() => document.querySelector('.rundetail .facts .code').textContent")
sf approve "$first" > "$work/approve.log" 2>&1 || fail "approve: $(cat "$work/approve.log")"
sf run > "$work/run2.log" 2>&1; [ $? -eq 1 ] || fail "the second run should stop at the check: $(cat "$work/run2.log")"
sf run > "$work/run3.log" 2>&1; [ $? -eq 3 ] || fail "the third run should wait for approval: $(cat "$work/run3.log")"
wait_for "the list follows the record" "() => [...document.querySelectorAll('.run .state')].map((m) => m.textContent).join(' | ') + ' ' + window.stayed" '^Waits for you \| Stopped \| Done yes$'
expect "the top bar counts what waits" "$(js "() => document.querySelector('.topbar .where span').textContent")" '^1 waits for you, 3 shown$'
expect "each row has its sentence" "$(js "() => [...document.querySelectorAll('.run .sentence')].map((s) => s.textContent).join(' | ')")" '^Ship it waits for your approval before it runs\. \| Stopped: .*check.*$'
expect "each row has its strip map" "$(js "() => document.querySelector('.run .strip').getAttribute('aria-label')")" '^Build passed; Review passed; Check passed; Ship it at work, the run is here$'
expect "the run that was shown is still the one shown" "$(js "() => document.querySelector('.rundetail h2').textContent")" '^Add an export button$'
shot runs-light-1440

# ---- 1. through the list by keyboard
tab_to '^Done.*[0-9]+ Add an export button'
expect "the keyboard is on the run that is shown" "$(js "() => document.activeElement.getAttribute('aria-selected')")" '^true$'
pw press Home
expect "Home goes to the newest" "$(js "$focused")" 'Show the cost of each lane'
pw press ArrowDown
expect "the arrow keys move through the runs" "$(js "$focused")" 'Fix the date format'
expect "the run beside the list follows" "$(js "() => document.querySelector('.rundetail h2').textContent")" '^Fix the date format$'
pw press End
expect "End goes to the oldest" "$(js "$focused")" 'Add an export button'
pw press Enter
expect "Enter goes into the run" "$(js "$focused")" '^Add an export button$'
expect "the run says how it stands" "$(js "() => document.querySelector('.rundetail .sentence').textContent")" '^Done\.$'
expect "the run that was entered is in the address" "$(js "() => location.pathname")" "^/runs/$first$"
in_window "a run"
shot run-light-1440

# ---- 2. the run on its map, stepped back and forth
expect "the map shows what the run did at each station" "$(js "() => [...document.querySelectorAll('.runmap .station.lane')].map((s) => s.getAttribute('aria-label').split(', ').pop()).join(' | ')")" '^passed in this run \| passed in this run \| passed in this run \| passed in this run$'
expect "the lines it took are lit, to the end" "$(js "() => document.querySelectorAll('.runmap .line.lit').length")" '^5$'
tab_to '^Replay the run'
expect "the control starts at the last step" "$(js "() => document.activeElement.getAttribute('aria-valuetext')")" '^Step 6 of 6: Ship it passed$'
pw press ArrowLeft && pw press ArrowLeft && pw press ArrowLeft && pw press ArrowLeft
expect "stepping back shows the run as it was" "$(js "() => document.activeElement.getAttribute('aria-valuetext')")" '^Step 2 of 6: Review failed$'
expect "the stations follow" "$(js "() => [...document.querySelectorAll('.runmap .station.lane')].map((s) => s.getAttribute('aria-label')).join(' | ')")" '^Lane Build, author, passed in this run \| Lane Review, reviewer, failed in this run, task 1 is here \| Lane Check, command \| Lane Ship it, command, waits for a person$'
expect "the train is where the run was" "$(js "() => document.querySelector('.runmap .train')?.closest('.station').getAttribute('aria-label')")" '^Lane Review'
shot run-replay-light-1440
pw press ArrowRight
expect "stepping forward goes on" "$(js "() => document.activeElement.getAttribute('aria-valuetext')")" '^Step 3 of 6: Build passed$'
pw press Home
expect "the first step is before any lane" "$(js "() => document.activeElement.getAttribute('aria-valuetext') + ' ' + document.querySelectorAll('.runmap [class*=ran-]').length")" '^Before the first lane 0$'
pw press End

# ---- 3. the evidence, each piece opened in place
shown() { # what the open proof with that label shows (several can be open at once)
  echo "() => [...document.querySelectorAll('.proof')].find((p) => p.querySelector('.what').textContent.startsWith('$1'))?.querySelector('.shown .output')?.textContent ?? ''"
}
tab_to '^The diff of the whole run'
pw press Enter
wait_for "the diff" "() => document.querySelector('.diff')?.textContent ?? ''" '\+\+\+ b/src/export\.ts'
expect "a line taken out or put in is marked" "$(js "() => document.querySelectorAll('.diff .add').length > 0")" '^true$'
shot run-diff-light-1440
tab_to '^Before and after'
pw press Enter
wait_for "a screenshot pair, both loaded" "() => [...document.querySelectorAll('.pair-shots img')].map((i) => i.complete && i.naturalWidth > 0).join(' ')" '^true true$'
expect "the pair is side by side" "$(js "() => { const [a, b] = [...document.querySelectorAll('.pair-shots img')].map((i) => i.getBoundingClientRect()); return a.right <= b.left && Math.abs(a.top - b.top) < 2; }")" '^true$'
expect "the diff stays open beside the pair, to compare" "$(js "() => document.querySelectorAll('.diff').length")" '^1$'
shot run-pair-light-1440
tab_to '^Recording: walkthrough\.webm'
pw press Enter
wait_for "a recording that has decoded" "() => (document.querySelector('video.shot')?.videoWidth ?? 0) > 0" '^true$'
in_window "a run with a pair and a recording open"
shot run-recording-light-1440
tab_to '^File: notes\.txt'
pw press Enter
wait_for "an attached note" "$(shown 'File: notes.txt')" 'Checked at 1440 and 390 wide'
tab_to '^Gate verify passed'
pw press Enter
wait_for "a gate's output" "$(shown 'Gate verify passed')" '^\$ true'
expect "its claims name their evidence" "$(js "() => [...document.querySelectorAll('.visits > li:first-child .ref')].map((r) => r.textContent).join(' ')")" '^file:src/export\.ts commit:HEAD attached:before\.png attached:after\.png attached:walkthrough\.webm attached:notes\.txt$'
# a claim's reference says the host checked it, and leads to the file it names
expect "each reference says whether the host found it" "$(js "() => [...document.querySelectorAll('.visits > li:first-child .ref .mark')].map((m) => m.getAttribute('aria-label')).join(' | ')")" '^(The host checked this: \| ){5}The host checked this:$'
back_to '^attached:notes\.txt$'
pw press Enter
wait_for "a reference opens the file it names" "() => [...document.querySelectorAll('.proof button[aria-expanded=true] .what')].map((w) => w.textContent).join(' | ')" 'File: notes\.txt'
tab_to '^Hand-off'
pw press Enter
wait_for "a hand-off" "$(shown 'Hand-off')" 'Added the export button'
shot run-lanes-light-1440

# ---- 4. the run that waits says what to do
back_to '^Done.*[0-9]+ Add an export button'
pw press Home
expect "back on the newest run" "$(js "$focused")" 'Show the cost of each lane'
expect "what waits names the command too" "$(js "() => document.querySelector('.waits')?.textContent.replace(/\\s+/g, ' ') ?? ''")" 'Ship it waits for your approval\..*Decide in the inbox.*softwarefactor approve [0-9a-f]+'
expect "the waiting run's train is yellow on its own map too" "$(js "() => document.querySelector('.runmap .train')?.getAttribute('class') ?? ''")" 'asks'
expect "the tab says that one waits" "$(js "() => document.title")" '^\(1\) Runs · Software Factor\.io$'
# from the run to its decision, and back with the keys for a section: g, then r
tab_to '^Decide in the inbox$'
pw press Enter
wait_for "the run's decision is one key away" "() => location.pathname.replace(/[0-9a-f]{8}/, 'RUN') + ' ' + (document.querySelector('.decide .asks')?.textContent ?? '')" '^/inbox/RUN Ship it waits for your approval before it runs\.$'
pw press g && pw press r
wait_for "g then r goes to Runs" "() => document.querySelector('h1').textContent + ' ' + location.pathname" '^Runs /runs$'

# ---- 5. dark, then the floor with the run on its map
theme Dark
shot runs-dark-1440
tab_to '^Before and after'
pw press Enter
wait_for "the pair in the dark" "() => [...document.querySelectorAll('.pair-shots img')].map((i) => i.complete && i.naturalWidth > 0).join(' ')" '^true true$'
shot run-dark-1440
section Floor
wait_for "the waiting run is on the floor's map" "() => document.querySelector('.map .train')?.closest('.station').getAttribute('aria-label') ?? ''" '^Lane Ship it, command, waits for a person, task 3 is here$'
expect "it is drawn as waiting for a person" "$(js "() => document.querySelector('.map .train').getAttribute('class')")" 'asks'
# the train is a way to its run's decision
tab_to '^Task 3: Show the cost of each lane'
pw press Enter
wait_for "a train leads to its decision" "() => location.pathname.replace(/[0-9a-f]{8}/, 'RUN')" '^/inbox/RUN$'
pw press g && pw press f
wait_for "g then f goes to the Floor" "() => document.querySelector('h1').textContent" '^Floor$'
shot floor-runs-dark-1440
tab_to '^Runs on map$'
pw press Space
expect "the runs can be taken off the map" "$(js "() => document.querySelectorAll('.map .train').length")" '^0$'
pw press Space
theme Light
shot floor-runs-light-1440

# ---- 5b. the workflow is changed after the runs: each run keeps the map it ran on
node -e 'const fs = require("fs"); const f = ".factor/workflows/delivery.json"; const w = JSON.parse(fs.readFileSync(f)); w.lanes.find((l) => l.id === "review").name = "Audit"; fs.writeFileSync(f, JSON.stringify(w, null, 2) + "\n");'
section Runs
wait_for "a run is drawn on the workflow it ran on" "() => [...document.querySelectorAll('.runmap .station.lane .name')].map((n) => n.textContent).join(' > ') + ' ' + (document.querySelector('.rundetail')?.textContent.includes('as it is today') ?? '')" '^Build > Review > Check > Ship it false$'
expect "its strip keeps its names too" "$(js "() => document.querySelector('.run[aria-selected=true] .strip')?.getAttribute('aria-label') ?? ''")" 'Review'
expect "a run's map is drawn to fit its box" "$(js "() => String(document.querySelector('.runmap .map').getBoundingClientRect().width <= document.querySelector('.runmap .map-scroll').clientWidth)")" '^true$'
section Floor
wait_for "the floor shows the workflow as it is now" "() => [...document.querySelectorAll('.station.lane .name')].map((n) => n.textContent).join(' > ')" '^Build > Audit > Check > Ship it$'

section Runs
# ---- 0. the state of a row, and the filter, by keyboard only
wait_for "each row's first line is its state, in a word" "() => [...document.querySelectorAll('.run')].map((r) => r.firstElementChild.className + ':' + r.firstElementChild.textContent).join(' | ')" '^state:Waits for you \| state:Stopped \| state:Done$'
expect "the filter offers All and each state that has a run, with counts" "$(js "() => [...document.querySelectorAll('.runfilter button')].map((b) => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(' | ')")" '^All 3\* \| Waits for you 1 \| Done 1 \| Stopped 1$'
tab_to '^Stopped 1$'
pw press Enter
wait_for "the list shows only what stopped" "$tasks" '^Fix the date format$'
expect "the heading's count stays true" "$(js "() => document.querySelector('.topbar .where span').textContent")" '^1 waits for you, 1 shown of 3$'
expect "the chosen filter is the pressed one" "$(js "() => [...document.querySelectorAll('.runfilter [aria-pressed=true]')].map((b) => b.textContent).join('|')")" '^Stopped 1$'
expect "the filter is in the address" "$(js "() => location.pathname + location.search")" '^/runs\?show=stopped$'
pw reload
wait_for "after a reload the filter is kept" "() => [...document.querySelectorAll('.runfilter [aria-pressed=true]')].map((b) => b.textContent).join('|') + ' ' + document.querySelectorAll('.run').length" '^Stopped 1 1$'
tab_to '^Waits for you 1$'
pw press Enter
wait_for "another state" "$tasks" '^Show the cost of each lane$'
tab_to '^All 3$'
pw press Enter
wait_for "back to All, with nothing in the address" "() => document.querySelectorAll('.run').length + ' ' + location.search + '.'" '^3 \.$'
expect "the heading is as before" "$(js "() => document.querySelector('.topbar .where span').textContent")" '^1 waits for you, 3 shown$'

# ---- 6. phone width: the list, then the run in its place
pw resize 390 844
wait_for "the list at phone width" "() => document.querySelectorAll('.run').length" '^3$'
fits "the runs"
walk "the runs"
expect "only the list shows" "$(js "() => getComputedStyle(document.querySelector('.rundetail')).display")" '^none$'
shot runs-light-390
tab_to 'Show the cost of each lane'
pw press End && pw press Enter
expect "Enter shows the run in place of the list" "$(js "() => getComputedStyle(document.querySelector('.runlist')).display + ' ' + document.activeElement.textContent")" '^none Add an export button$'
fits "a run"
walk "a run"
shot run-light-390
tab_to '^Before and after'
pw press Enter
wait_for "the pair, one above the other" "() => { const s = [...document.querySelectorAll('.pair-shots img')]; if (s.length < 2 || !s.every((i) => i.naturalWidth > 0)) return 'not yet'; const [a, b] = s.map((i) => i.getBoundingClientRect()); return String(a.bottom <= b.top && document.documentElement.scrollWidth <= 390); }" '^true$'
shot run-pair-light-390
theme Dark
shot run-pair-dark-390
shot run-dark-390
back_to '^All runs$'
pw press Enter
expect "back to the list, on the run that was open" "$(js "$focused")" 'Add an export button'
shot runs-dark-390
theme Light

playwright-cli -s="$session" console error > "$work/console.log" 2>&1
grep -Eq "^\[ERROR\]|Error:" "$work/console.log" && fail "the page logged an error: $(cat "$work/console.log")"
playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "runs: ok"
