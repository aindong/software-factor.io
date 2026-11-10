#!/bin/bash
# The inbox, accounts, costs and plugins in a real browser, by keyboard. Needs playwright-cli and
# a built command (pnpm run build). The page is driven with key presses only and then read.
# Usage: bash test/ui/inbox.sh [folder for screenshots]
# Prints "inbox: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="inbox-$$"
server=""
cleanup='[ -n "${slow:-}" ] && kill "$slow" 2> /dev/null'
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }

# ---- a workspace whose tasks come from four lists, each taking its own way through the workflow:
# work that waits for approval when done, a command that waits before it runs, a question, and a
# long command that holds the one slot
mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
rm -f .factor/workflows/starter.json
node -e '
const fs = require("fs");
const from = (id) => ({ id, uses: "core/file@1", with: { path: ".factor/" + id + ".md" } });
const via = (source) => ({ ref: "task.source", in: [source] });
const workflow = {
  $schema: "https://softwarefactor.io/schema/workflow/v1.json",
  version: 1,
  name: "delivery",
  description: "Sort a task by where it came from, then build, ship or ask.",
  roles: { author: { description: "Writes." }, reviewer: { description: "Reads.", differentVendorFrom: ["author"] } },
  limits: { minutes: 60, tokens: 1000000 },
  commands: { verify: { description: "The tests." } },
  collectors: ["builds", "ships", "questions", "slow"].map(from),
  gates: { verify: { uses: "core/command@1", with: { command: "verify" }, onFail: "fail" } },
  lanes: [
    { id: "sort", name: "Sort", uses: "core/command@1", with: { run: "true" }, checkpoint: "out",
      on: { pass: [{ to: "ask", when: via("questions") }, { to: "ship", when: via("ships") }, { to: "slow", when: via("slow") }, { to: "build" }], fail: "@stop" } },
    { id: "build", name: "Build", uses: "core/agent@1", agent: { role: "author", access: "write", prompt: "Build it." },
      gates: ["verify"], checkpoint: "in", on: { pass: "@done", fail: "@stop" } },
    { id: "ship", name: "Ship it", uses: "core/command@1", with: { run: "true" }, checkpoint: "in", on: { pass: "@done", fail: "@stop" } },
    { id: "ask", name: "Plan", uses: "core/agent@1", agent: { role: "author", access: "read", prompt: "Plan it." },
      checkpoint: "out", on: { pass: "@done", fail: "@stop" } },
    { id: "slow", name: "Reindex", uses: "core/command@1", with: { run: "sleep 60" }, checkpoint: "out", on: { pass: "@done", fail: "@stop" } },
  ],
};
fs.writeFileSync(".factor/workflows/delivery.json", JSON.stringify(workflow, null, 2));
const f = JSON.parse(fs.readFileSync(".factor/factory.json"));
fs.writeFileSync(".factor/factory.json", JSON.stringify({ ...f, workflow: "delivery", commands: { verify: "true" }, slots: { max: 1 } }, null, 2));
fs.writeFileSync(".factor/builds.md", "- [ ] Add an export button\n");
fs.writeFileSync(".factor/ships.md", "- [ ] Publish the release\n");
fs.writeFileSync(".factor/questions.md", "- [ ] Pick a database\n");
const build = (file) => [{ write: { path: file, content: "export const label = 1;\n" } }, { commit: "Add " + file }, { usage: { tokens: 18400, usd: 0.31 } }, { handoff: { outcome: "pass", summary: "Added " + file + "." } }];
const roles = {
  author: { adapter: "fake", script: {
    build: [build("src/export.ts"), build("src/export.test.ts")],
    ask: [[{ usage: { tokens: 2100, usd: 0.03 } }, { handoff: { outcome: "needsPerson", summary: "Which database should the export read from?" } }], [{ usage: { tokens: 900, usd: 0.01 } }, { handoff: { outcome: "pass", summary: "Planned for Postgres." } }]],
  } },
  reviewer: { adapter: "fake" },
};
fs.writeFileSync(".factor/local.json", JSON.stringify({ roles }, null, 2));
'
git add -A && git commit -q -m "set up the factory"
sf check > "$work/check.log" 2>&1 || fail "the workflow does not pass the checker: $(cat "$work/check.log")"
for n in 1 2 3; do
  sf run > "$work/run$n.log" 2>&1; [ $? -eq 3 ] || fail "run $n should wait for a person: $(cat "$work/run$n.log")"
done
sf account add work --agent command --command "true" > /dev/null || fail "account add"
sf account add spare --agent command --command "true" --limit 5h=2000000 > /dev/null || fail "account add"
run_of() { sf runs | grep -B0 "$1" | head -1 | cut -d' ' -f1; }

sf ui --port 0 > "$work/ui.log" 2>&1 &
server=$!
for _ in $(seq 1 50); do grep -q "#t=" "$work/ui.log" && break; sleep 0.1; done
address=$(grep -o 'http://127.0.0.1:[0-9]*/#t=[0-9a-f]*' "$work/ui.log") || fail "the interface did not start: $(cat "$work/ui.log")"
pw open "$address" || fail "the browser did not open"
grep -q "Console: [1-9]" "$work/pw.log" && fail "the page logged an error: $(cat "$work/pw.log")"
pw resize 1440 900

# ---- 1. the rail counts what waits, and the inbox lists it with the run beside it
wait_for "the rail counts what waits" "() => document.querySelector('.rail .count')?.textContent ?? ''" '^3 wait for you$'
section Inbox
wait_for "the inbox lists what waits" "() => [...document.querySelectorAll('.run .task')].map((t) => t.textContent).join(' | ')" '^Add an export button \| Publish the release \| Pick a database$'
expect "an approval and a question are told apart" "$(js "() => [...document.querySelectorAll('.run .mark')].map((m) => m.getAttribute('aria-label')).join(' | ')")" '^An approval \| An approval \| A question$'
wait_for "the run's map is beside the item" "() => document.querySelectorAll('.deciding .runmap .station.lane').length" '^5$'
expect "the decisions the first item takes" "$(js "() => [...document.querySelectorAll('.choices .button')].map((b) => b.textContent).join(' | ')")" '^Approve a \| Reject r \| Send back s$'
shot inbox-light-1440

# ---- 2. s: a note first, and nothing is sent while it is empty
tab_to '^Add an export button'
pw press s
expect "s puts the keyboard in the note" "$(js "() => document.activeElement.tagName + ' ' + document.activeElement.labels[0].textContent")" '^TEXTAREA What should change'
pw press Enter
expect "an empty note sends nothing and says why" "$(js "() => document.querySelector('.topbar .status').textContent")" '^Say what the lane should do differently\. Nothing was sent\.$'
[ "$(ls .factor/runs/*/prompts/*build* | wc -l | tr -d ' ')" = "1" ] || fail "something was sent with an empty note"
pw type "use tabs, not spaces"
pw press Enter
wait_for "the work is sent back" "() => document.querySelector('.topbar .status').textContent" '^Sent back\.'
for _ in $(seq 1 40); do [ "$(ls .factor/runs/*/prompts/*build* | wc -l | tr -d ' ')" = "2" ] && break; sleep 0.2; done
grep -lq "use tabs, not spaces" .factor/runs/*/prompts/*build* || fail "the lane did not get the note"
wait_for "the lane ran again and waits again, as the newest item" "() => [...document.querySelectorAll('.run .task')].map((t) => t.textContent).join(' | ') + ' ' + (document.querySelector('.rail .count')?.textContent ?? '')" '^Publish the release \| Pick a database \| Add an export button 3 wait'
shot inbox-sent-back-light-1440

# ---- 3. a command that has not run: no work to send back, and a approves it
tab_to '^Publish the release'
pw press ArrowDown
expect "the arrow keys move through the inbox" "$(js "$focused")" '^Pick a database'
pw press ArrowUp
expect "and back" "$(js "$focused")" '^Publish the release'
expect "work that is not done cannot be sent back" "$(js "() => [...document.querySelectorAll('.choices .button')].map((b) => b.textContent).join(' | ')")" '^Approve a \| Reject r$'
pw press s
expect "s says why not" "$(js "() => document.querySelector('.topbar .status').textContent")" 'has not run yet'
pw press a
wait_for "a approves, and the item leaves the list" "() => [...document.querySelectorAll('.run .task')].map((t) => t.textContent).join(' | ')" '^Pick a database \| Add an export button$'
wait_for "the rail counts one fewer" "() => document.querySelector('.rail .count')?.textContent ?? ''" '^2 wait for you$'
sf runs | grep -A1 "Publish the release" | grep -q "Done\." || fail "the approved run did not go on to Done: $(sf runs)"

# ---- 4. the factory refuses: every slot is busy, and its own words are on the page
echo "- [ ] Rebuild the index" > .factor/slow.md
sf run > "$work/slow.log" 2>&1 &
slow=$!
for _ in $(seq 1 40); do sf runs | grep -q "Reindex: its command is running" && break; sleep 0.2; done
sf runs | grep -q "Reindex: its command is running" || fail "the long run did not start: $(sf runs)"
tab_to '^Pick a database'
pw press ArrowDown
expect "the approval is chosen" "$(js "$focused")" '^Add an export button'
pw press a
wait_for "a refusal is shown in the factory's words, with what to do" "() => document.querySelector('.topbar .status').textContent" '^Every slot is busy, so run [0-9a-f]+ cannot continue yet\. Decide again when a run has finished'
expect "the refusal is marked as one" "$(js "() => document.querySelector('.topbar .status').className")" 'bad'
expect "the item is still there" "$(js "() => document.querySelectorAll('.run').length")" '^2$'
shot inbox-refused-light-1440
sf stop "$(run_of 'Rebuild the index')" > /dev/null 2>&1
wait "$slow" 2> /dev/null
slow=""

# ---- 5. a question: a typed answer and Enter, and letters typed into it decide nothing
tab_to '^Add an export button'
pw press ArrowUp
expect "the question is chosen" "$(js "$focused")" '^Pick a database'
expect "the question is shown" "$(js "() => document.querySelector('.decide .asks').textContent")" '^Which database should the export read from\?$'
pw press Enter
expect "Enter puts the keyboard in the answer" "$(js "() => document.activeElement.tagName + ' ' + document.activeElement.labels[0].textContent")" '^TEXTAREA Your answer'
pw type "as"
expect "letters typed into the answer decide nothing" "$(js "() => document.activeElement.value + ' ' + document.querySelectorAll('.run').length + ' ' + document.querySelector('.topbar .status').textContent.startsWith('Approved')")" '^as 2 false$'
shot inbox-question-light-1440
pw type " Postgres, the one we already run"
pw press Enter
wait_for "the answer is sent" "() => document.querySelector('.topbar .status').textContent" '^Answered\.'
wait_for "the question leaves the list" "() => [...document.querySelectorAll('.run .task')].map((t) => t.textContent).join(' | ')" '^Add an export button$'
for _ in $(seq 1 40); do grep -lq "as Postgres, the one we already run" .factor/runs/*/prompts/*ask* 2> /dev/null && break; sleep 0.2; done
grep -lq "as Postgres, the one we already run" .factor/runs/*/prompts/*ask* || fail "the lane did not get the answer"

# ---- 6. the last approval, with a slot free again: nothing waits
tab_to '^Add an export button'
pw press a
wait_for "nothing waits" "() => document.querySelector('.plain')?.textContent ?? ''" '^Nothing waits for you\.'
expect "the rail's count is gone" "$(js "() => document.querySelectorAll('.rail .count').length")" '^0$'
shot inbox-empty-light-1440

# ---- 7. accounts: the logins, and a role bound by keyboard
section Accounts
wait_for "the logins are listed" "() => [...document.querySelectorAll('.table tbody')][0]?.innerText.replace(/\\s+/g, ' ') ?? ''" '^work command no limit set no spare command 0 of 2,000,000 tokens in 5 h no$'
expect "the page tells nothing of a login" "$(js "() => /true|profile|\\.claude\\//.test(document.querySelector('.table').innerText)")" '^false$'
tab_to '^Account for the role author$'
pw press s
expect "typing a letter picks the account" "$(js "() => document.activeElement.value")" '^spare$'
tab_to '^Effort for the role author$'
pw press h
tab_to '^Bind$'
pw press Enter
wait_for "the role is bound" "() => document.querySelector('.topbar .status').textContent" '^The role author is now worked by spare\.$'
wait_for "the row shows what the record now holds" "() => document.querySelector('select[aria-label=\"Account for the role author\"]').value + ' ' + document.querySelector('select[aria-label=\"Effort for the role author\"]').value" '^spare high$'
node -e 'const r = require("./.factor/local.json").roles.author; if (r.account !== "spare" || r.effort !== "high") { console.error(JSON.stringify(r)); process.exit(1); }' || fail "local.json does not hold the binding"
sf role list | grep -q "author .*spare" || fail "the command line does not show the binding: $(sf role list)"
shot accounts-light-1440

# ---- 8. costs: the three tables and the whole, the same numbers the command line prints
section Costs
wait_for "the three tables" "() => [...document.querySelectorAll('.page h2')].map((h) => h.textContent).join(' | ')" '^By lane \| By task \| By account$'
total=$(sf cost | grep '^Total' | sed -E 's/.* ([0-9]+) tokens +\$([0-9.]+).*/\1 \2/')
expect "the whole is the command line's" "$(js "() => document.querySelector('.topbar .where span').textContent.replace(/,/g, '')")" "^${total% *} tokens \\\$${total#* }"
expect "each lane has its row" "$(js "() => [...document.querySelectorAll('.costs')][0].querySelectorAll('tbody tr').length")" '^2$'
shot costs-light-1440

# ---- 9. plugins: what is built in, by its real names
section Plugins
wait_for "what is built in" "() => document.querySelector('.page')?.innerText ?? ''" 'core/agent@1'
for name in core/command@1 core/wait@1 core/test-floor@1 core/file@1 claude codex kimi fake alleo-loop bugfix-fast research-only; do
  expect "$name is listed" "$(js "() => document.querySelector('.page').innerText.includes('$name')")" '^true$'
done
expect "installing is said to be not built yet" "$(js "() => document.querySelector('.page').innerText")" 'not built yet'
shot plugins-light-1440

# ---- 10. dark, and phone width: no section scrolls sideways
theme Dark
shot plugins-dark-1440
section Costs && sleep 0.4 && shot costs-dark-1440
section Accounts && sleep 0.4 && shot accounts-dark-1440
# something to decide again, for the inbox in the dark and at phone width
echo "- [ ] Ship the hotfix" >> .factor/ships.md
sf run > "$work/run5.log" 2>&1; [ $? -eq 3 ] || fail "run 5 should wait: $(cat "$work/run5.log")"
section Inbox
wait_for "the new item appears" "() => [...document.querySelectorAll('.run .task')].map((t) => t.textContent).join(' | ')" '^Ship the hotfix$'
shot inbox-dark-1440
pw resize 390 844
narrow "the inbox"
shot inbox-dark-390
tab_to '^Ship the hotfix'
pw press Enter
expect "Enter shows the decision in place of the list" "$(js "() => getComputedStyle(document.querySelector('.runlist')).display + ' ' + getComputedStyle(document.querySelector('.deciding')).display")" '^none grid$'
narrow "the decision"
shot inbox-item-dark-390
theme Light
shot inbox-item-light-390
for name in Accounts Costs Plugins; do
  section "$name"
  sleep 0.4
  narrow "$name"
  shot "$(echo "$name" | tr '[:upper:]' '[:lower:]')-light-390"
done
theme Dark
for name in Accounts Costs; do
  section "$name"
  sleep 0.4
  shot "$(echo "$name" | tr '[:upper:]' '[:lower:]')-dark-390"
done
theme Light

# the page logged no error but the refusal's own answer
playwright-cli -s="$session" console error > "$work/console.log" 2>&1
grep -E "^\[ERROR\]" "$work/console.log" | grep -v "409" > "$work/errors.log"
[ -s "$work/errors.log" ] && fail "the page logged an error: $(cat "$work/errors.log")"
[ "$(grep -c "409" "$work/console.log")" = "1" ] || fail "one refusal was expected in the console: $(cat "$work/console.log")"
playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "inbox: ok"
