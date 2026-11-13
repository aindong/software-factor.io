#!/bin/bash
# From the final critique, in a real browser, by keyboard. (1) The server is started again while
# the floor holds a change: the page is not loaded again, nothing is lost, and with the new
# address in the same tab the change can be saved. (2) Arriving in the inbox puts the keyboard on
# the section's name, one Tab before the list, and a deciding key pressed there says what to do
# instead of nothing: no key decides on an item the person did not choose. (3) Arriving on an item
# from a run's page leaves the keyboard on that item.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/restart.sh [folder for screenshots]
# Prints "restart: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="restart-$$"
server=""
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }
status() { js "() => document.querySelector('.topbar .status').textContent"; }
loaded='() => String(performance.timeOrigin)'

mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
one_lane
node -e 'const fs = require("fs"); const f = JSON.parse(fs.readFileSync(".factor/factory.json")); f.commands.verify = "true"; fs.writeFileSync(".factor/factory.json", JSON.stringify(f, null, 2));'
printf -- '- [ ] First\n- [ ] Second\n' > .factor/tasks.md
git add -A && git commit -q -m "a factory"
sf run > /dev/null 2>&1 # the first task waits for its approval

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
wait_for "the workflow is drawn" "() => document.querySelectorAll('.station.lane').length" '^1$'

# ---- 0. the first stop of the Tab order is a skip link that leads to the screen's main content
pw press Tab
expect "the Floor: the first Tab stop is the skip link" "$(js "$focused")" '^Skip to the map$'
pw press Enter
expect "the Floor: it leads into the map" "$(js "() => String(!!document.activeElement.closest('.map-scroll'))")" '^true$'

# ---- 1. the server is started again while the floor holds a change
tab_to '^Lane '
pw press Enter
tab_to '^Instructions'
pw press End
pw type " Keep the change small."
expect "the floor holds a change" "$(status)" '^Not saved$'
before=$(js "$loaded")
port=$(echo "$address" | sed -E 's|.*:([0-9]+)/.*|\1|')
kill "$server" && wait "$server" 2> /dev/null
start_ui "$port" # the same place, a new key
sleep 7 # the page asks the server again every two seconds: three times at least
expect "the page was not loaded again" "$(js "$loaded")" "^$before\$"
expect "and still holds the change" "$(status) $(js "() => document.activeElement.value.includes('Keep the change small.')")" '^Not saved true$'
pw press Control+s
wait_for "a save with the old key says where the new one is" "() => document.querySelector('.topbar .status').textContent" 'open the address the command printed'
[ -n "$shots" ] && pw screenshot --filename="$shots/restart-key-refused-light-1440.png"
pw goto "$address" # the printed address, in this tab
sleep 1
expect "the new address does not load the page again either" "$(js "$loaded")" "^$before\$"
expect "the key is taken out of the address bar" "$(js '() => location.hash')" '^$'
pw press Control+s
wait_for "and now the change is saved" "() => document.querySelector('.topbar .status').textContent" '^Saved'
grep -q "Keep the change small." .factor/workflows/starter.json || fail "the workflow file does not hold the change"
sleep 3
wait_for "the page hears the server again: the tab says what waits" "() => document.title" '^\(1\) '

# ---- 2. the same from another section: the tab says its key is refused, and takes the address there
tab_to '^Lane '
pw press Enter
tab_to '^Instructions'
pw press End
pw type " Say what you checked."
expect "the floor holds a change again" "$(status)" '^Not saved$'
section Inbox
wait_for "the inbox is on the page" "() => document.querySelector('h1').textContent" '^Inbox'
kill "$server" && wait "$server" 2> /dev/null
start_ui "$port"
notice='() => document.querySelector(".keyless")?.textContent ?? ""'
wait_for "the tab says its key is no longer good, and why it was kept" "$notice" 'started again.*not saved.*address'
expect "it was not loaded again" "$(js "$loaded")" "^$before\$"
[ -n "$shots" ] && pw screenshot --filename="$shots/restart-key-refused-light-1440.png"
wait_for "the top bar says the key is refused, not that the page is trying again" "() => document.querySelector('.topbar .status.bad')?.textContent ?? ''" "key is refused"
tab_to '^The address the command printed$'
pw type "$address"
wait_for "the address typed there is taken, and the notice says so" "$notice" '^Key taken\. Save to keep your changes\.$'
[ -n "$shots" ] && pw screenshot --filename="$shots/restart-key-taken-light-1440.png"
wait_for "and goes by itself after a few seconds" "$notice" '^$'
expect "still without loading the page again" "$(js "$loaded")" "^$before\$"
wait_for "the page hears the server again from the inbox" "() => document.querySelector('.topbar .status.bad')?.textContent ?? 'connected'" '^connected$'
section Floor
pw press Control+s
wait_for "and the change made before the restart is saved" "() => document.querySelector('.topbar .status').textContent" '^Saved'
grep -q "Say what you checked." .factor/workflows/starter.json || fail "the workflow file does not hold the second change"

# ---- 3. a save right after a restart, before the page has noticed: the refusal itself keeps the tab
tab_to '^Lane '
pw press Enter
tab_to '^Instructions'
pw press End
pw type " Third."
kill "$server" && wait "$server" 2> /dev/null
start_ui "$port"
pw press Control+s
wait_for "the refused save brings the notice at once" "$notice" 'address'
pw goto "$address"
sleep 1
expect "the address in the tab is taken in place, and the notice only says so" "$(js "$loaded") $(js "$notice")" "^$before (Key taken\\. Save to keep your changes\\.)?\$"
pw press Control+s
wait_for "and the third change is saved" "() => document.querySelector('.topbar .status').textContent" '^Saved'

# ---- 4. arriving in the inbox
section Inbox
wait_for "the inbox is on the page" "() => document.querySelector('h1').textContent" '^Inbox'
expect "the keyboard is at the section's name: nothing is chosen for the person" "$(js "$focused")" '^Inbox$'
ring='() => getComputedStyle(document.activeElement).outlineStyle'
expect "a heading the page itself focused shows no ring: it is not a control" "$(js "$ring")" '^none$'
pw press a
hint='() => { const s = document.querySelector(".said"); return s && s.getClientRects().length > 0 ? s.textContent : ""; }'
wait_for "a deciding key outside the list says what to do" "$hint" '^Choose an item first'
expect "and decides nothing" "$(js "() => document.querySelectorAll('.runlist .run').length")" '^1$'
[ -n "$shots" ] && pw screenshot --filename="$shots/restart-inbox-choose-light-1440.png"
pw press Tab
expect "the list is one Tab away" "$(js "$focused")" '^[0-9]+ First'
expect "the list says how its rows move" "$(js "() => document.querySelector('.listside').innerText")" '↑ ↓ move between items, Enter opens'
expect "what a person can Tab to keeps its ring" "$(js "$ring")" '^solid$'
back_to '^Skip to the list$'
expect "the Inbox: the skip link is the first stop of the Tab order" "$(js "() => ${tabbable}[0].textContent")" '^Skip to the list$'
wait_for "the hint goes once an item is chosen" "$hint" '^$'
# in a narrow window the list stands alone: the answer must be on show there too
pw resize 390 800
section Runs
section Inbox
shown='() => document.querySelector(".runlist .run").getAttribute("aria-selected") + " " + getComputedStyle(document.querySelector(".runlist .run")).boxShadow + " " + document.querySelector(".listside").innerText.includes("move between")'
expect "at phone width no row is marked while no item is open, and the arrow keys are not explained" "$(js "$shown")" '^false none false$'
pw press a
wait_for "at phone width the answer is on show, not in a part that is hidden" "$hint" '^Choose an item first'
pw resize 1440 900
tab_to '^[0-9]+ First'
pw press a
wait_for "on the item, a approves it" "() => document.querySelector('.said')?.textContent ?? ''" 'pproved'

# ---- 5. arriving on an item from a run's page: the item is on show, so the keyboard works on it
for _ in $(seq 1 40); do sf run > "$work/second.log" 2>&1 && break; [ $? -eq 3 ] && break; sleep 0.5; done
sf inbox 2> /dev/null | grep -q Second || fail "the second task does not wait: $(sf inbox)"
# a third task whose lane says something else: the list tells the two waiting items apart
printf -- '- [ ] Third\n' >> .factor/tasks.md
sed -i.bak 's/Added FACTOR-HELLO.md./Added the other file./' .factor/local.json && rm -f .factor/local.json.bak
sf run > "$work/third.log" 2>&1; [ $? -eq 3 ] || fail "the third task should wait: $(cat "$work/third.log")"
section Inbox
wait_for "each waiting item carries what its own lane said" "() => [...document.querySelectorAll('.runlist .sentence')].map((s) => s.textContent).join(' | ')" 'Added FACTOR-HELLO\.md\..*\|.*Added the other file\.'
shot inbox-summaries-light-1440
section Runs
tab_to 'Third'
pw press Enter
tab_to '^Decide in the inbox$'
pw press Enter
wait_for "the inbox shows the run's item" "() => location.pathname.startsWith('/inbox/') && document.querySelectorAll('.deciding').length === 1" '^true$'
pw press a
wait_for "a approves the item on show, and does not say to choose one" "() => document.querySelector('.said')?.textContent ?? ''" '^Approved: Third'
# the next item is on show and the keyboard is on its row; the window becomes a phone's, the row goes, and so does the keyboard
wait_for "the next item is on show" "() => location.pathname.startsWith('/inbox/') && document.querySelector('.rundetail h2')?.textContent.includes('Second')" '^true$'
pw resize 390 800
sleep 0.4
expect "the keyboard has nowhere to be but the page" "$(js "$focused")" '^\(nothing\)$'
pw press a
wait_for "a approves the item on show wherever the keyboard is" "() => document.querySelector('.said')?.textContent ?? ''" '^Approved: Second'
pw resize 1440 900

# ---- 6. Costs and Plugins: the skip link, the figures, and a command that is not broken across lines
section Costs
wait_for "Costs is on the page" "() => document.querySelector('h1')?.textContent ?? ''" '^Costs$'
back_to '^Skip to the content$'
expect "Costs: the skip link is the first stop of the Tab order" "$(js "() => ${tabbable}[0].textContent")" '^Skip to the content$'
pw press Enter
expect "Costs: it leads into the page" "$(js "() => String(!!document.activeElement.closest('.page'))")" '^true$'
page='() => document.querySelector(".page").innerText.replace(/\s+/g, " ")'
expect "the cache hit rate says none yet when no session could read a cache" "$(js "$page")" 'Cache hit rate[[:space:]]+none yet'
per=$(sf cost | sed -nE 's/^ *cost per landed task +([^ ]+) .*/\1/p')
[ -n "$per" ] || fail "the command prints no cost per landed task: $(sf cost)"
expect "the cost per landed task is the one the command prints" "$(js "$page")" "Cost per landed task[[:space:]]+${per//\$/\\\$}"
shot costs-figures-light-1440
pw resize 390 800
section Plugins
wait_for "what is built in" "$page" 'core/agent@1'
expect "no inline code is broken across lines" "$(js "() => { const c = [...document.querySelectorAll('.page code')].filter((e) => e.textContent.length <= 40); return c.some((e) => /--available/.test(e.textContent)) && c.every((e) => e.getClientRects().length === 1) ? 'one line' : c.map((e) => e.textContent + ' ' + e.getClientRects().length).join('; '); }")" '^one line$'
expect "no line of the lists of names begins with a separator" "$(js "() => { const li = [...document.querySelectorAll('.names li')]; const first = li.filter((e, i) => i === 0 || e.getBoundingClientRect().top > li[i - 1].getBoundingClientRect().top + 2); return li.length > 3 && first.length < li.length ? (first.some((e) => getComputedStyle(e, '::before').content.includes('\u00b7')) ? 'a line begins with a separator' : 'none') : 'the names do not wrap: ' + li.length; }")" '^none$'
shot plugins-code-light-390

playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "restart: ok"
