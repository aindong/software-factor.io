#!/bin/bash
# Each login's limits on the Accounts page, in a real browser, by keyboard only: the windows its CLI
# reports, each with a meter and its percent as text, a window not printed said to be not reported,
# a reading that failed said with its reason, Codex said to report nothing, the factory's own count
# named apart, a login on hold or near a limit marked in words, and a new reading by the button.
# Read only when the page opens and when asked. Both themes, at 1440 and at 390 wide, nothing cut
# off and nothing scrolling sideways at 390. The CLIs are stand-ins: no real CLI is started.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/accounts-limits.sh [folder for screenshots]
# Prints "accounts-limits: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="limits-$$"
server=""
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
# as test/helpers/clean-env.ts does for the suite: the variables of an outer factory run (this check
# run as a lane's) must not reach the throwaway workspace the check makes
for name in $(env | sed -nE 's/^(FACTOR_[A-Za-z0-9_]*)=.*/\1/p'); do unset "$name"; done
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }

# login <name> <exit code> <what it prints>: a Claude Code login whose CLI is a stand-in script
login() {
  local dir="$work/profiles/$1"
  mkdir -p "$dir"
  printf '%s\n' "$3" > "$dir/out.txt"
  if [ "$2" = 0 ]; then : > "$dir/err.txt"; else echo "Not logged in · Please run /login" > "$dir/err.txt"; fi
  # shellcheck disable=SC2016 # the stand-in's own variables, expanded when it runs
  printf '#!/bin/sh\nhere=$(dirname "$0")\necho "$*" >> "$here/args.txt"\ncat "$here/out.txt"\ncat "$here/err.txt" >&2\nexit %s\n' "$2" > "$dir/claude"
  chmod 755 "$dir/claude"
  shift 3
  sf account add "$(basename "$dir")" --agent claude --profile "$dir" --bin "$dir/claude" "$@" > /dev/null || fail "account add $(basename "$dir")"
}
calls() { [ -f "$work/profiles/$1/args.txt" ] && wc -l < "$work/profiles/$1/args.txt" | tr -d ' ' || echo 0; }

mkdir -p "$work/shop" "$work/profiles/other" && cd "$work/shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# shop" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
login work 0 "Current week (all models): 73% used · resets Nov 15 at 6:59am (Asia/Manila)
Current week (Fable): 92% used · resets Nov 15 at 7am (Asia/Manila)" --limit 5h=1000
login spare 0 "Current session: 40% used · resets 3pm (Asia/Manila)
Current week (all models): 41% used · resets Nov 15 at 6:59am (Asia/Manila)"
login broken 1 ""
sf account add other --agent codex --profile "$work/profiles/other" > /dev/null || fail "account add other"
node -e '
const fs = require("fs");
const now = Date.now();
fs.appendFileSync(process.argv[1], JSON.stringify({ at: now - 60000, account: "work", tokens: 400 }) + "\n");
fs.appendFileSync(process.argv[1], JSON.stringify({ at: now, account: "spare", holdUntil: now + 3600000 }) + "\n");
' "$FACTOR_HOME/usage.jsonl" || fail "usage.jsonl"

# the text of one login: the article headed by its name
block() { echo "() => [...document.querySelectorAll('.page article')].find((a) => a.querySelector('h3')?.textContent.trim().startsWith('$1'))?.innerText.replace(/\\s+/g, ' ') ?? 'no login $1'"; }
# every meter has its percent as text beside it, in the same row
meters='() => { const all = [...document.querySelectorAll(".page [role=meter], .page meter")]; if (all.length === 0) return "no meter"; return all.filter((m) => { const n = Math.round(Number(m.getAttribute("aria-valuenow") ?? m.value)); return !m.parentElement.innerText.includes(n + "% used"); }).map((m) => m.getAttribute("aria-label") || "a meter").join(" | ") || "none"; }'
count='() => document.querySelectorAll(".page [role=meter], .page meter").length'
# nothing of the page is cut off: no box hides text it holds, and nothing reaches past the window
cut='() => [...document.querySelectorAll(".page *")].filter((e) => { const c = getComputedStyle(e); if (e.closest("select")) return false; const hides = /hidden|clip/.test(c.overflowX) || c.textOverflow === "ellipsis"; return (hides && e.scrollWidth > e.clientWidth + 1) || e.getBoundingClientRect().right > innerWidth + 0.5; }).map((e) => (e.getAttribute("aria-label") || e.className || e.tagName) + ": " + (e.textContent || "").trim().slice(0, 30)).join(" | ") || "none"'
checks() { # checks <where>
  expect "every meter has its percent as text: $1" "$(js "$meters")" '^none$'
  expect "a meter for each window that was reported, and none for one that was not: $1" "$(js "$count")" '^4$'
  expect "nothing is cut off: $1" "$(js "$cut")" '^none$'
}

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
section Accounts
wait_for "the windows of work are shown" "$(block work)" '73% used'

# ---- 1. the logins and their limits first, the roles second
expect "the logins are the page's first subject, the roles its second" "$(js "() => [...document.querySelectorAll('.page h2')].map((h) => h.textContent.trim()).join(' | ')")" '^Logins.* \| Who works each role'

# ---- 2. each window: its name, its percent as text, a meter, when it resets; a window not printed is not reported
w=$(js "$(block work)")
expect "work shows its week for all models" "$w" 'Current week \(all models\).*73% used.*resets Nov 15 at 6:59am \(Asia/Manila\)'
expect "work shows its week for Fable" "$w" 'Current week \(Fable\).*92% used.*resets Nov 15 at 7am \(Asia/Manila\)'
expect "a window work's CLI did not print is said to be not reported" "$w" 'Current session[^%]*not reported'
expect "no window is shown as 0" "$(js "() => /(^|[^0-9])0% used/.test(document.querySelector('.page').innerText)")" '^false$'
expect "the page says how old the reading is" "$w" 'Read (just now|[0-9]+ min ago)'

# ---- 3. the factory's own count, named apart from the CLI's windows
expect "the factory's own count is named and shown" "$w" "[Tt]he factory's own count.*400 of 1,000 tokens in 5 h"

# ---- 4. a login near a limit or on hold is marked in words
expect "work, at 92% of a window, is marked near a limit" "$w" 'Near a limit'
expect "spare is marked on hold" "$(js "$(block spare)")" 'On hold'
expect "spare, under 90% of every window, is not marked near a limit" "$(js "() => (($(block spare))()).includes('Near a limit')")" '^false$'

# ---- 5. a failed reading says why, Codex says it reports nothing, and the rest still shows
expect "the failed reading says why" "$(js "$(block broken)")" 'could not be read.*Not logged in'
expect "Codex says in plain words that it reports nothing" "$(js "$(block other)")" 'Codex[^.]*model call'
checks "light 1440"
shot accounts-limits-light-1440

# ---- 6. read when the page opened, never in the background, and again when asked
expect "the page read work's CLI once when it opened" "$(calls work)" '^1$'
sleep 3
expect "nothing is read in the background" "$(calls work)" '^1$'
printf '%s\n' "Current week (all models): 75% used · resets Nov 15 at 6:59am (Asia/Manila)" "Current week (Fable): 92% used · resets Nov 15 at 7am (Asia/Manila)" > "$work/profiles/work/out.txt"
tab_to '^Read the limits again$'
pw press Enter
wait_for "the button takes a new reading" "$(block work)" '75% used'
expect "the button read work's CLI once more" "$(calls work)" '^2$'
expect "Codex was never started" "$(ls "$work/profiles/other")" '^$'
walk "the accounts page"

# ---- 7. dark, and phone width
theme Dark
checks "dark 1440"
shot accounts-limits-dark-1440
pw resize 390 844
fits "the accounts"
checks "dark 390"
shot accounts-limits-dark-390
theme Light
fits "the accounts"
checks "light 390"
shot accounts-limits-light-390

playwright-cli -s="$session" console error > "$work/console.log" 2>&1
grep -E "^\[ERROR\]" "$work/console.log" > "$work/errors.log"
[ -s "$work/errors.log" ] && fail "the page logged an error: $(cat "$work/errors.log")"
playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "accounts-limits: ok"
