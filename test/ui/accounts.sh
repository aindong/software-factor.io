#!/bin/bash
# Who works each role, in a real browser, by keyboard: a role bound by choosing its models from the
# list of its account's agent, the binding read back from the command line, the list changing with
# the account, and selects as wide as their longest option in both themes at 1440 and 390.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/accounts.sh [folder for screenshots]
# Prints "accounts: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="accounts-$$"
server=""
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }

# ---- the starter workspace, a Claude Code login and a Codex one, and a key of local.json that is not a role
mkdir -p "$work/shop" "$work/profiles/claude" "$work/profiles/codex" && cd "$work/shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# shop" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
sf account add claude-main --agent claude --profile "$work/profiles/claude" --bin "$here/test/fixtures/bin/claude" > /dev/null || fail "account add claude-main"
sf account add openai-main --agent codex --profile "$work/profiles/codex" --bin "$here/test/fixtures/bin/codex" > /dev/null || fail "account add openai-main"
sf role bind reviewer --account claude-main --medium sonnet > /dev/null || fail "role bind reviewer"
node -e '
const fs = require("fs");
const local = JSON.parse(fs.readFileSync(".factor/local.json", "utf8"));
fs.writeFileSync(".factor/local.json", JSON.stringify({ ...local, servers: { tracker: "a1b2c3" } }, null, 2));
' || fail "local.json"
before=$(node -e 'const l = require("./.factor/local.json"); console.log(JSON.stringify([l.servers, l.roles.reviewer, l.roles.tester]))')

# no select of the roles is narrower than its longest option's text and its padding, the arrow's room among them
cut='() => { const pen = document.createElement("canvas").getContext("2d"); return [...document.querySelectorAll(".roles select")].filter((s) => { const c = getComputedStyle(s); pen.font = c.font; const text = Math.max(...[...s.options].map((o) => pen.measureText(o.text).width)); return text + parseFloat(c.paddingLeft) + parseFloat(c.paddingRight) > s.clientWidth + 0.5; }).map((s) => s.getAttribute("aria-label")).join(" | ") || "none"; }'
uncut() { expect "no select cuts its text off: $1" "$(js "$cut")" '^none$'; }
# a select is drawn by the page, as the fields are: no native look, one chevron of its own with room left for it.
drawn='() => [...document.querySelectorAll(".roles select")].filter((s) => { const c = getComputedStyle(s); return c.appearance !== "none" || parseFloat(c.paddingRight) < 24 || !/url|gradient|svg/.test(c.backgroundImage); }).map((s) => s.getAttribute("aria-label")).join(" | ") || "none"'
# a role's description reads on at most two lines, and nothing of a row is outside the screen or cut off
lay='() => { const bad = [...document.querySelectorAll(".roles tbody th .sub:first-of-type")].filter((d) => { const c = getComputedStyle(d); return d.getBoundingClientRect().height > 2 * (parseFloat(c.lineHeight) || 1.5 * parseFloat(c.fontSize)) + 1; }).map((d) => "description of " + d.closest("th").childNodes[0].textContent); for (const e of document.querySelectorAll(".roles select, .roles input")) if (e.scrollWidth > e.clientWidth || e.getBoundingClientRect().right > innerWidth) bad.push(e.getAttribute("aria-label")); return bad.join(" | ") || "none"; }'
look() { expect "the selects are drawn by the page: $1" "$(js "$drawn")" '^none$'; }
laid() { expect "a role's row reads well: $1" "$(js "$lay")" '^none$'; }
field='(e) => { const c = getComputedStyle(e); return [e.getBoundingClientRect().height, c.borderTopWidth, c.borderTopColor, c.borderRadius, c.backgroundColor, c.color, c.fontSize, c.fontFamily].join(" / "); }'
model_of() { echo "() => document.querySelector('select[aria-label=\"Model for $1 lanes of author\"]')"; }
row_text='() => document.querySelector("select[aria-label=\"Account for the role author\"]").closest("tr").innerText.replace(/\s+/g, " ")'

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
section Accounts
wait_for "the roles are listed" "() => [...document.querySelectorAll('.roles tbody th')].map((t) => t.childNodes[0].textContent).join(' | ')" '^author \| reviewer \| tester$'

# ---- 1. the account, then the model of each tier from the list of its agent
tab_to '^Account for the role author$'
pw press c
expect "typing a letter picks the account" "$(js "() => document.activeElement.value")" '^claude-main$'
tab_to '^Model for small lanes of author$'
expect "the model is chosen from a list" "$(js "() => document.activeElement.tagName")" '^SELECT$'
expect "the list is Claude Code's, newest first, between the CLI's own and another model" "$(js "() => [...document.activeElement.options].map((o) => o.text).join(' | ')")" "^the CLI's own \\| Opus 5\\.5 \\(claude-opus-5-5\\) \\| Sonnet 5\\.5 \\(claude-sonnet-5-5\\) \\| Haiku 5\\.5 \\(claude-haiku-5-5\\) \\| .* \\| Another model$"
expect "no model of another agent is offered" "$(js "() => [...document.activeElement.options].some((o) => o.value.startsWith('gpt-'))")" '^false$'
pw press a
wait_for "another model opens a text field" "() => document.querySelector('input[aria-label=\"Another model for small lanes of author\"]') ? 'open' : 'none'" '^open$'
expect "the text field looks like the selects beside it" "$(js "() => { const f = $field; return f(document.querySelector('input[aria-label=\"Another model for small lanes of author\"]')) === f(document.querySelector('select[aria-label=\"Model for medium lanes of author\"]')) && f(document.querySelector('select[aria-label=\"Account for the role author\"]')) === f(document.querySelector('select[aria-label=\"Effort for the role author\"]')); }")" '^true$'
tab_to '^Another model for small lanes of author$'
pw type "claude-preview-6"
tab_to '^Model for medium lanes of author$'
pw press s
expect "typing a letter picks a model" "$(js "() => ($(model_of medium))().value")" '^claude-sonnet-5-5$'
tab_to '^Model for large lanes of author$'
pw press o
expect "typing a letter picks a model" "$(js "() => ($(model_of large))().value")" '^claude-opus-5-5$'
tab_to '^Effort for the role author$'
pw press h
tab_to '^Bind$'
pw press Enter
wait_for "the role is bound" "() => document.querySelector('.topbar .status').textContent" '^The role author is now worked by claude-main\.$'

# ---- 2. the command line says the same, and the rest of local.json is as it was
sf role list | grep '^author ' | grep -qF "claude-main (claude)  small claude-preview-6, medium claude-sonnet-5-5, large claude-opus-5-5, effort high" ||
  fail "the command line does not show the binding: $(sf role list)"
node -e 'const r = require("./.factor/local.json").roles.author; const want = { account: "claude-main", models: { small: "claude-preview-6", medium: "claude-sonnet-5-5", large: "claude-opus-5-5" }, effort: "high" }; if (JSON.stringify(r) !== JSON.stringify(want)) { console.error(JSON.stringify(r)); process.exit(1); }' ||
  fail "local.json does not hold the binding"
after=$(node -e 'const l = require("./.factor/local.json"); console.log(JSON.stringify([l.servers, l.roles.reviewer, l.roles.tester]))')
[ "$after" = "$before" ] || fail "binding a role changed the rest of local.json: $before became $after"
wait_for "a bound model the list does not know is shown and kept" "() => { const s = ($(model_of small))(); return s.value + ' ' + s.selectedOptions[0].text; }" '^claude-preview-6 claude-preview-6$'
uncut "light 1440"
laid "light 1440"
look "light"
shot accounts-light-1440

# ---- 3. another agent's account: its list, and the models of the other agent cleared with a word
back_to '^Account for the role author$'
pw press o
expect "the account is the Codex one" "$(js "() => document.activeElement.value")" '^openai-main$'
expect "no model of the other agent is kept" "$(js "() => ['small', 'medium', 'large'].map((t) => document.querySelector('select[aria-label=\"Model for ' + t + ' lanes of author\"]').value || '-').join(' ')")" '^- - -$'
expect "the row says they were cleared" "$(js "$row_text")" 'cleared.*claude-opus-5-5'
expect "the list is Codex's" "$(js "() => [...($(model_of medium))().options].map((o) => o.text).join(' | ')")" "^the CLI's own \\| GPT-6\\.1 Sol \\(gpt-6\\.1-sol\\) \\| .* \\| Another model$"
expect "with no model of Claude Code" "$(js "() => [...($(model_of medium))().options].some((o) => o.value.startsWith('claude-'))")" '^false$'
uncut "light 1440, Codex"

# ---- 4. dark, and phone width
theme Dark
uncut "dark 1440"
laid "dark 1440"
look "dark"
shot accounts-dark-1440
pw resize 390 844
fits "the accounts"
uncut "dark 390"
laid "dark 390"
shot accounts-dark-390
theme Light
uncut "light 390"
laid "light 390"
shot accounts-light-390

playwright-cli -s="$session" console error > "$work/console.log" 2>&1
grep -E "^\[ERROR\]" "$work/console.log" > "$work/errors.log"
[ -s "$work/errors.log" ] && fail "the page logged an error: $(cat "$work/errors.log")"
playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "accounts: ok"
