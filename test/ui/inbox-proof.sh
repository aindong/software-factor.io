#!/bin/bash
# The inbox puts the proof before the decision, in a real browser, by keyboard: in an item's detail
# the lane the decision is about comes first, above the run's map, with its evidence already open;
# at phone width it starts within the first screen; the open evidence can be closed by keyboard.
# Needs playwright-cli and a built command (pnpm run build). The page is driven with key presses only.
# Usage: bash test/ui/inbox-proof.sh [folder for screenshots]
# Prints "inbox-proof: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="inbox-proof-$$"
server=""
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }

# one task: Sort runs, Build (an agent) waits for approval when done, then Ship waits before it runs
mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
rm -f .factor/workflows/starter.json
node -e '
const fs = require("fs");
const workflow = {
  $schema: "https://softwarefactor.io/schema/workflow/v1.json",
  version: 1,
  name: "delivery",
  description: "Sort, build, ship.",
  roles: { author: { description: "Writes." } },
  limits: { minutes: 60, tokens: 1000000 },
  commands: { verify: { description: "The tests." } },
  collectors: [{ id: "tasks", uses: "core/file@1", with: { path: ".factor/tasks.md" } }],
  gates: { verify: { uses: "core/command@1", with: { command: "verify" }, onFail: "fail" } },
  lanes: [
    { id: "sort", name: "Sort", uses: "core/command@1", with: { run: "true" }, checkpoint: "near", on: { pass: "build", fail: "@stop" } },
    { id: "build", name: "Build", uses: "core/agent@1", agent: { role: "author", access: "write", prompt: "Build it." },
      gates: ["verify"], checkpoint: "in", on: { pass: "ship", fail: "@stop" } },
    { id: "ship", name: "Ship it", uses: "core/command@1", with: { run: "true" }, checkpoint: "in", on: { pass: "@done", fail: "@stop" } },
  ],
};
fs.writeFileSync(".factor/workflows/delivery.json", JSON.stringify(workflow, null, 2));
const f = JSON.parse(fs.readFileSync(".factor/factory.json"));
fs.writeFileSync(".factor/factory.json", JSON.stringify({ ...f, workflow: "delivery", commands: { verify: "true" } }, null, 2));
fs.writeFileSync(".factor/tasks.md", "- [ ] Add an export button\n");
const script = [
  { write: { path: "src/export.ts", content: "export const label = 1;\n" } }, { commit: "Add src/export.ts" },
  { handoff: { outcome: "pass", summary: "Added the export button.", claims: [{ text: "The button exists.", evidence: ["file:src/export.ts"] }] } },
];
fs.writeFileSync(".factor/local.json", JSON.stringify({ roles: { author: { adapter: "fake", script: { "*": script } }, } }, null, 2));
'
git add -A && git commit -q -m "set up the factory"
sf check > "$work/check.log" 2>&1 || fail "the workflow does not pass the checker: $(cat "$work/check.log")"
sf run > "$work/run.log" 2>&1; [ $? -eq 3 ] || fail "the run should wait for a person: $(cat "$work/run.log")"

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
section Inbox
wait_for "the approval waits" "$tasks" '^Add an export button$'
tab_to '^[0-9]+ Add an export button'
pw press Enter
wait_for "the item is entered" "() => location.pathname" '^/inbox/'

# ---- an approval after a lane: that lane first, above the map, its evidence open
lead='document.querySelector(".deciding .lead")'
wait_for "the lane that waits comes first, and says why" "() => ${lead}?.querySelector('h3')?.textContent ?? ''" '^What you are approving$'
expect "it is the Build lane" "$(js "() => ${lead}.querySelector('h4').textContent")" '^Build$'
expect "it comes before the map" "$(js "() => !!(${lead}.compareDocumentPosition(document.querySelector('.deciding .runmap')) & Node.DOCUMENT_POSITION_FOLLOWING)")" '^true$'
expect "its evidence is open without a key press" "$(js "() => ${lead}.querySelector('.proof > button[aria-expanded]').getAttribute('aria-expanded')")" '^true$'
expect "with its claim and its gate and their results" "$(js "() => ${lead}.innerText")" 'The button exists\.(.|\n)*Gate verify passed'
expect "the other lanes follow without repeating it" "$(js "() => [...document.querySelectorAll('.deciding .visits h4')].map((h) => h.textContent).join(' | ')")" '^Sort$'
expect "in the tab order the lane comes before the map" "$(js "() => { const t = ${tabbable}; return t.findIndex((e) => ${lead}.contains(e)) < t.findIndex((e) => e.closest('.runmap')); }")" '^true$'
shot inbox-proof-light-1440
pw resize 390 844
sleep 0.4
expect "at phone width the lane starts within the first screen" "$(js "() => Math.round(${lead}.getBoundingClientRect().top) < 500")" '^true$'
expect "and its gate result is on that screen" "$(js "() => { const g = [...${lead}.querySelectorAll('.what')].find((w) => /^Gate verify passed/.test(w.textContent)); return !!g && g.getBoundingClientRect().top < innerHeight; }")" '^true$'
fits "the decision"
shot inbox-proof-light-390
theme Dark
shot inbox-proof-dark-390
pw resize 1440 900
sleep 0.4
shot inbox-proof-dark-1440
theme Light

# ---- the open evidence can be closed and opened again by keyboard
tab_to '^Evidence for Build'
pw press Enter
expect "Enter closes it" "$(js "() => ${lead}.querySelector('.proof > button[aria-expanded]').getAttribute('aria-expanded')")" '^false$'
pw press Enter
expect "and opens it again" "$(js "() => ${lead}.querySelector('.proof > button[aria-expanded]').getAttribute('aria-expanded')")" '^true$'

# ---- an approval before a lane: the last lane that ran comes first (a, heard from the proof, approves Build)
pw press a
wait_for "approved, and the run waits before Ship it" "() => ${lead}?.querySelector('h3')?.textContent ?? ''" '^What ran before this approval$'
expect "the last lane that ran is Build" "$(js "() => ${lead}.querySelector('h4').textContent")" '^Build$'
expect "its evidence is open" "$(js "() => ${lead}.querySelector('.proof > button[aria-expanded]').getAttribute('aria-expanded')")" '^true$'
expect "it comes before the map" "$(js "() => !!(${lead}.compareDocumentPosition(document.querySelector('.deciding .runmap')) & Node.DOCUMENT_POSITION_FOLLOWING)")" '^true$'
shot inbox-proof-before-light-1440

# a second task, so that after one decision another waits
echo "- [ ] Add a search box" >> .factor/tasks.md
sf run > "$work/run2.log" 2>&1; [ $? -eq 3 ] || fail "the second run should wait for a person: $(cat "$work/run2.log")"

# ---- at phone width, with the list showing, a deciding key decides nothing: the bar and the proof are not on show
# (at 1440 a on a focused row approves: restart.sh, "on the item, a approves it")
pw resize 390 844
sleep 0.4
section Runs
section Inbox
wait_for "the list stands alone" "() => getComputedStyle(document.querySelector('.deciding')).display" '^none$'
tab_to '^[0-9]+ Add an export button'
pw press a
refused='() => { const s = document.querySelector(".said"); return s && s.getClientRects().length > 0 ? s.textContent : ""; }'
wait_for "a on a row of the list says to open the item first" "$refused" '^Open the item first: Enter opens it\.$'
expect "and the items still wait" "$(js "$tasks")" '^Add an export button \| Add a search box$'
expect "and the sentence does not cover the row" "$(js "() => document.querySelector('.said').getBoundingClientRect().bottom <= document.querySelector('.runlist .run').getBoundingClientRect().top")" '^true$'
shot inbox-key-refused-light-390
theme Dark
shot inbox-key-refused-dark-390
theme Light
tab_to '^[0-9]+ Add an export button'
pw press Enter
wait_for "Enter opens the item" "() => getComputedStyle(document.querySelector('.deciding')).display" '^grid$'
pw press a
wait_for "now a approves it" "() => document.querySelector('.said')?.textContent ?? ''" '^Approved: Add an export button'

# ---- at phone width the item is shown in place of the list, so after a decision by key the keyboard
# goes to the next item's heading (as Enter on a row puts it there), not to a row that is not shown.
# (at 1440 it goes to the next row: inbox.sh, "a approves, and the keyboard is on the next row")
wait_for "the page moves on to the next item" "() => document.querySelector('.rundetail h2')?.textContent ?? ''" 'Add a search box'
expect "the keyboard is on the next item's heading, not on the page" "$(js "$focused")" 'Add a search box'
shot inbox-focus-next-light-390
pw press a
wait_for "a second a, with no Tab, approves the next item" "() => document.querySelector('.said')?.textContent ?? ''" '^Approved: Add a search box'
# its run now waits before Ship it: the last item. It may arrive after the page moved on, so enter it from the list
wait_for "the same task waits again, before Ship it" "() => ${lead}?.querySelector('h3')?.textContent ?? ''" '^What ran before this approval$'
tab_to '^[0-9]+ Add a search box'
pw press Enter
wait_for "Enter opens it" "() => getComputedStyle(document.querySelector('.deciding')).display" '^grid$'
pw press a
wait_for "the last item is approved" "() => document.querySelector('.plain')?.textContent ?? ''" 'Nothing waits for you'
expect "with no item left the keyboard is on the Inbox heading, not on the page" "$(js "$focused")" '^Inbox$'

playwright-cli -s="$session" console error > "$work/console.log" 2>&1
grep -E "^\[ERROR\]" "$work/console.log" > "$work/errors.log"
[ -s "$work/errors.log" ] && fail "the page logged an error: $(cat "$work/errors.log")"
playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "inbox-proof: ok"
