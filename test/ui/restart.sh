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
expect "the address in the tab is taken in place" "$(js "$loaded") $(js "$notice")" "^$before \$"
pw press Control+s
wait_for "and the third change is saved" "() => document.querySelector('.topbar .status').textContent" '^Saved'

# ---- 4. arriving in the inbox
section Inbox
wait_for "the inbox is on the page" "() => document.querySelector('h1').textContent" '^Inbox'
expect "the keyboard is at the section's name: nothing is chosen for the person" "$(js "$focused")" '^Inbox$'
pw press a
hint='() => { const s = document.querySelector(".said"); return s && s.getClientRects().length > 0 ? s.textContent : ""; }'
wait_for "a deciding key outside the list says what to do" "$hint" '^Choose an item first'
expect "and decides nothing" "$(js "() => document.querySelectorAll('.runlist .run').length")" '^1$'
[ -n "$shots" ] && pw screenshot --filename="$shots/restart-inbox-choose-light-1440.png"
pw press Tab
expect "the list is one Tab away" "$(js "$focused")" '^[0-9]+ First'
wait_for "the hint goes once an item is chosen" "$hint" '^$'
# in a narrow window the list stands alone: the answer must be on show there too
pw resize 390 800
section Runs
section Inbox
pw press a
wait_for "at phone width the answer is on show, not in a part that is hidden" "$hint" '^Choose an item first'
pw resize 1440 900
tab_to '^[0-9]+ First'
pw press a
wait_for "on the item, a approves it" "() => document.querySelector('.said')?.textContent ?? ''" 'pproved'

# ---- 5. arriving on an item from a run's page: the item is on show, so the keyboard works on it
for _ in $(seq 1 40); do sf run > "$work/second.log" 2>&1 && break; [ $? -eq 3 ] && break; sleep 0.5; done
sf inbox 2> /dev/null | grep -q Second || fail "the second task does not wait: $(sf inbox)"
section Runs
tab_to 'Second'
pw press Enter
tab_to '^Decide in the inbox$'
pw press Enter
wait_for "the inbox shows the run's item" "() => location.pathname.startsWith('/inbox/') && document.querySelectorAll('.deciding').length === 1" '^true$'
pw press a
wait_for "a approves the item on show, and does not say to choose one" "() => document.querySelector('.said')?.textContent ?? ''" '^Approved: Second'

playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "restart: ok"
