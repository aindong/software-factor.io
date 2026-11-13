#!/bin/bash
# The inbox in a real browser, by keyboard: an approval before a command lane says what the command
# does and on which branch (and an approval after a lane does not); a row names its kind only for a
# question, so the title has the room; a deciding key pressed outside an open item says where the
# keys work; and at phone width the last confirmation does not push the next item's decision down.
# Needs playwright-cli and a built command (pnpm run build). The page is driven with key presses only.
# Usage: bash test/ui/inbox-ahead.sh [folder for screenshots]
# Prints "inbox-ahead: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="inbox-ahead-$$"
server=""
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }

# two builds that wait for approval when done and then wait before Ship it (a described command), and a question
mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
rm -f .factor/workflows/starter.json
node -e '
const fs = require("fs");
const from = (id) => ({ id, uses: "core/file@1", with: { path: ".factor/" + id + ".md" } });
const workflow = {
  $schema: "https://softwarefactor.io/schema/workflow/v1.json",
  version: 1,
  name: "delivery",
  description: "Sort, build, ship or ask.",
  roles: { author: { description: "Writes." } },
  limits: { minutes: 60, tokens: 1000000 },
  commands: {
    verify: { description: "The tests." },
    ship: { description: "Pushes the run branch and opens a pull request." },
  },
  collectors: ["builds", "questions"].map(from),
  gates: { verify: { uses: "core/command@1", with: { command: "verify" }, onFail: "fail" } },
  lanes: [
    { id: "sort", name: "Sort", uses: "core/command@1", with: { run: "true" }, checkpoint: "out",
      on: { pass: [{ to: "ask", when: { ref: "task.source", in: ["questions"] } }, { to: "build" }], fail: "@stop" } },
    { id: "build", name: "Build", uses: "core/agent@1", agent: { role: "author", access: "write", prompt: "Build it." },
      gates: ["verify"], checkpoint: "in", on: { pass: "ship", fail: "@stop" } },
    { id: "ship", name: "Ship it", uses: "core/command@1", with: { command: "ship" }, checkpoint: "in", on: { pass: "@done", fail: "@stop" } },
    { id: "ask", name: "Plan", uses: "core/agent@1", agent: { role: "author", access: "read", prompt: "Plan it." },
      checkpoint: "out", on: { pass: "@done", fail: "@stop" } },
  ],
};
fs.writeFileSync(".factor/workflows/delivery.json", JSON.stringify(workflow, null, 2));
const f = JSON.parse(fs.readFileSync(".factor/factory.json"));
fs.writeFileSync(".factor/factory.json", JSON.stringify({ ...f, workflow: "delivery", commands: { verify: "true", ship: "true" }, slots: { max: 2 } }, null, 2));
fs.writeFileSync(".factor/builds.md", "- [ ] Add an export button for the monthly sales report\n- [ ] Add a search box to the order list\n");
fs.writeFileSync(".factor/questions.md", "- [ ] Pick a database\n");
const build = (file) => [{ write: { path: file, content: "export const label = 1;\n" } }, { commit: "Add " + file }, { handoff: { outcome: "pass", summary: "Added " + file + "." } }];
const roles = { author: { adapter: "fake", script: {
  build: [build("src/export.ts"), build("src/search.ts")],
  ask: [[{ handoff: { outcome: "needsPerson", summary: "Which database should the export read from?" } }]],
} } };
fs.writeFileSync(".factor/local.json", JSON.stringify({ roles }, null, 2));
'
git add -A && git commit -q -m "set up the factory"
sf check > "$work/check.log" 2>&1 || fail "the workflow does not pass the checker: $(cat "$work/check.log")"
for n in 1 2 3; do
  sf run > "$work/run$n.log" 2>&1; [ $? -eq 3 ] || fail "run $n should wait for a person: $(cat "$work/run$n.log")"
done

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
section Inbox
wait_for "the inbox lists what waits" "$tasks" 'monthly sales report \| .*search box.* \| Pick a database'

# ---- a row names its kind only for a question
expect "only the question says what it is" "$(js "() => [...document.querySelectorAll('.run .when')].map((w) => w.textContent).join(' | ')")" '^question$'
expect "an approval's title has the whole row" "$(js "() => { const t = document.querySelector('.runlist .run .task'); return t.scrollWidth <= t.clientWidth; }")" '^true$'

# ---- an approval after a lane says nothing of a command: its work can be sent back
tab_to '^[0-9]+ Add an export button'
pw press Enter
wait_for "the item is entered" "() => location.pathname" '^/inbox/'
ahead='() => document.querySelector(".decide .ahead")?.innerText ?? "none"'
expect "work that was done shows no command" "$(js "$ahead")" '^none$'

# ---- an approval before a command lane says what the command does, and on which branch
pw press a
wait_for "the page moves on to the next build" "() => document.querySelector('.rundetail h2')?.textContent ?? ''" 'search box'
sleep 1
pw press a
wait_for "both builds wait before Ship it, and the question is first" "$tasks" '^Pick a database \| Add an export button .* \| Add a search box'
back_to '^[0-9]+ (Pick a database|Add an export button)'
js "$focused" | grep -q "export button" || pw press ArrowDown
expect "the keyboard is on the export button's row" "$(js "$focused")" '^[0-9]+ Add an export button'
pw press Enter
wait_for "the item that waits before Ship it is on show" "() => document.querySelector('.decide .next')?.textContent ?? ''" '^Approve: Ship it starts next\.$'
run=$(js "() => location.pathname" | sed 's|/inbox/||')
branch=$(git branch --format='%(refname:short)' | grep -F "$run" | head -1)
[ -n "$branch" ] || fail "no branch holds the run id $run: $(git branch)"
wait_for "the command's description is under the bar" "$ahead" 'Pushes the run branch and opens a pull request\.'
expect "with the run's branch" "$(js "$ahead")" "$branch"
expect "and the command's name" "$(js "$ahead")" 'ship'
expect "it is under the buttons" "$(js "() => { const a = document.querySelector('.decide .ahead'); return !!(document.querySelector('.decide .choices').compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING); }")" '^true$'
expect "what is decided reads before the line about what approving starts, which is quieter" "$(js "() => { const w = (e) => Number(getComputedStyle(e).fontWeight); const a = document.querySelector('.decide .asks:not(.next)'); const n = document.querySelector('.decide .asks.next'); return w(n) < w(a); }")" '^true$'
expect "the one key stays" "$(js "() => [...document.querySelectorAll('.choices .button')].map((b) => b.textContent).join(' | ')")" '^Approve a \| Reject r$'
shot inbox-ahead-light-1440
pw resize 390 844
sleep 0.4
fits "the command's description"
expect "at phone width it is still under the buttons, on the screen" "$(js "() => { const a = document.querySelector('.decide .ahead').getBoundingClientRect(); return a.bottom <= innerHeight && a.top >= document.querySelector('.decide .choices').getBoundingClientRect().bottom; }")" '^true$'
shot inbox-ahead-light-390
theme Dark
shot inbox-ahead-dark-390
theme Light

# ---- a deciding key from outside an open item names where the keys work, not a list that is not on show
pw press a
hint='() => { const s = document.querySelector(".said"); return s && s.getClientRects().length > 0 ? s.textContent : ""; }'
wait_for "the answer is true of what is on show" "$hint" '^The deciding keys work in the open item: Tab moves to it\.$'
pw resize 1440 900
sleep 0.4

# ---- at phone width the last confirmation does not push the next item's decision down
pw resize 390 844
sleep 0.4
tab_to '^Approve a$|^Approve$'
pw press a
wait_for "the next item is on show with what was decided said" "() => document.querySelector('.said')?.textContent ?? ''" '^Approved: .*Ship it'
shot inbox-approved-light-390
expect "the decision is on the screen" "$(js "() => document.querySelector('.decide').getBoundingClientRect().bottom <= innerHeight")" '^true$'
expect "the page does not scroll" "$(js "() => document.documentElement.scrollHeight <= innerHeight")" '^true$'
expect "the confirmation is not inside the next item" "$(js "() => !document.querySelector('.deciding').contains(document.querySelector('.said'))")" '^true$'
expect "and takes no room above it" "$(js "() => document.querySelector('.deciding').getBoundingClientRect().top <= document.querySelector('.topbar').getBoundingClientRect().bottom + 1")" '^true$'
shot inbox-approved-light-390
wait_for "the confirmation goes by itself after a few seconds" "$said" '^$'

playwright-cli -s="$session" console error > "$work/console.log" 2>&1
grep -E "^\[ERROR\]" "$work/console.log" > "$work/errors.log"
[ -s "$work/errors.log" ] && fail "the page logged an error: $(cat "$work/errors.log")"
playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "inbox-ahead: ok"
