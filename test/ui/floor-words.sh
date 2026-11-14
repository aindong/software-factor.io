#!/bin/bash
# The words and marks around the Floor's map, round three (G5 to G9), at desk width, by keyboard:
# an idle Floor says so where the counts are; JSON that does not parse says so in one line in the fail
# colour with the diamond, directly under the top bar, the parser's detail after it in soft ink; a refused
# lane id marks its field and says plainly what is allowed and that the lane keeps its id; the Model size
# and Effort selects show their whole text; the lane panel says "Out of the loop" once.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/floor-words.sh [folder for screenshots]
# Prints "floor-words: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="floor"
server=""
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
for name in $(env | sed -nE 's/^(FACTOR_[A-Za-z0-9_]*)=.*/\1/p'); do unset "$name"; done
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }
mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"

needs='() => document.querySelector(".topbar .needs")?.textContent ?? "no line"'
start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
wait_for "the workflow is drawn" "() => document.querySelectorAll('.station.lane').length" '^[1-9]'

# G9. nothing queued, waiting, working or stopped: the counts' place says so, in soft ink
wait_for "an idle Floor says so" "$needs" '^Nothing queued, nothing waiting\.$'
expect "in soft ink, as the counts are" "$(js "() => { const n = document.querySelector('.topbar .needs'); const soft = getComputedStyle(n).color; const probe = document.createElement('i'); probe.style.color = 'var(--ink-soft)'; document.body.append(probe); const want = getComputedStyle(probe).color; probe.remove(); return soft === want ? 'soft' : soft + ' is not ' + want; }")" '^soft$'
shot floor-idle-light-1440
kill "$server" 2> /dev/null

# a workflow with one lane at "out", and tasks to take; one run waits and one is stopped elsewhere
elsewhere 1 1
node -e '
const fs = require("fs");
const w = { $schema: "https://softwarefactor.io/schema/workflow/v1.json", version: 1, name: "queue", description: "One command.", roles: {}, limits: { minutes: 10, tokens: 1000 }, collectors: [{ id: "tasks", uses: "core/file@1", with: { path: ".factor/queue.md" } }],
  lanes: [{ id: "ship", name: "Ship", uses: "core/command@1", with: { run: "true" }, checkpoint: "out", on: { pass: "@done", fail: "@stop" } }] };
fs.writeFileSync(".factor/workflows/queue.json", JSON.stringify(w, null, 2));
fs.writeFileSync(".factor/queue.md", "- [ ] First chore\n");
const f = JSON.parse(fs.readFileSync(".factor/factory.json")); f.workflow = "queue"; fs.writeFileSync(".factor/factory.json", JSON.stringify(f, null, 2));'
git add -A && git commit -q -m "the queue workflow"
sf collect > /dev/null || fail "collect"
start_ui 0 # the workspace as it is read at the start
pw open "$address" || fail "the browser did not open"
wait_for "the counts are back" "$needs" '^1 waits for you · 1 stopped · 1 queued$'
wait_for "the one lane is drawn" "() => document.querySelectorAll('.station.lane').length" '^1$'

# G8. the lane's panel: "Out of the loop" is said once, in a sentence
for _ in $(seq 1 40); do
  [ "$(js "$focused")" != "(nothing)" ] && js "() => document.activeElement.matches('.map .station')" | grep -q true && break
  pw press Tab
done
pw press Enter
wait_for "the ladder is read" "() => document.querySelectorAll('.inspector .ladder').length" '^1$'
expect "the panel says \"Out of the loop\" in one sentence only" "$(js "() => [...document.querySelectorAll('.inspector .hint, .inspector .note')].filter((e) => /out of the loop/i.test(e.textContent)).length")" '^1$'

# G6. a refused id: the field is marked, and the sentence says what is allowed and that the lane keeps its id
tab_to '^Id'
pw type "X" # the id is selected when the keyboard arrives: this replaces it with a capital, which an id may not hold
pw press Tab
expect "the field is marked as wrong" "$(js "() => document.querySelector('.inspector input[aria-invalid=true]') ? 'marked' : 'not marked'")" '^marked$'
expect "with the fail colour for its border" "$(js "() => { const i = document.querySelector('.inspector input[aria-invalid=true]'); const probe = document.createElement('i'); probe.style.color = 'var(--return)'; document.body.append(probe); const want = getComputedStyle(probe).color; probe.remove(); return getComputedStyle(i).borderTopColor === want ? 'fail' : getComputedStyle(i).borderTopColor + ' is not ' + want; }")" '^fail$'
expect "the sentence says what is allowed and what stays" "$(js "() => document.querySelector('.inspector .hint.bad')?.textContent ?? 'no sentence'")" '^Not used: an id holds only small letters, digits and -, and no other lane may have it\. The lane is still ship\.$'
shot floor-pending-light-1440
back_to '^Id'
pw type "ship"
pw press Tab
expect "the mark goes when the id is good again" "$(js "() => document.querySelectorAll('.inspector input[aria-invalid=true]').length")" '^0$'

# G7. Model size and Effort show their whole text: add an agent lane (it opens), and measure the selects
tab_to '^Add a lane$'
pw press Enter
tab_to '^Agent$'
pw press Enter
wait_for "the new lane's panel is open" "() => document.querySelectorAll('.inspector select').length" '^[5-9]$'
expect "no select of the panel cuts its text" "$(js "() => { const out = []; for (const s of document.querySelectorAll('.inspector .field select')) { const c = getComputedStyle(s); const probe = document.createElement('span'); probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:' + c.font; probe.textContent = s.selectedOptions[0]?.textContent ?? ''; document.body.append(probe); const need = probe.getBoundingClientRect().width; probe.remove(); const room = s.getBoundingClientRect().width - parseFloat(c.paddingLeft) - parseFloat(c.paddingRight); if (need > room + 0.5) out.push(s.selectedOptions[0].textContent + ' needs ' + Math.round(need) + ' of ' + Math.round(room)); } return out.length ? out.join('; ') : 'whole'; }")" '^whole$'
shot floor-lane-selected-light-1440

# G5. JSON that does not parse: one line in the fail colour with the diamond, right under the top bar
tab_to '^JSON$'
pw press Enter
tab_to '^The workflow as JSON$'
pw press "$text_bottom"
pw type "{"
wait_for "the problem is said" "() => document.querySelector('.broken')?.textContent ?? ''" 'not JSON'
expect "directly under the top bar" "$(js "() => { const b = document.querySelector('.broken').getBoundingClientRect(); const t = document.querySelector('.topbar').getBoundingClientRect(); return b.top - t.bottom <= 2 ? 'under' : Math.round(b.top - t.bottom) + ' px below it'; }")" '^under$'
expect "above the text it is about" "$(js "() => document.querySelector('.broken').getBoundingClientRect().bottom <= document.querySelector('.json textarea').getBoundingClientRect().top + 1")" '^true$'
expect "in one line" "$(js "() => { const b = document.querySelector('.broken'); return b.getBoundingClientRect().height <= 1.6 * parseFloat(getComputedStyle(b).lineHeight) + parseFloat(getComputedStyle(b).paddingBlock) * 2 ? 'one line' : 'taller: ' + b.getBoundingClientRect().height; }")" '^one line$'
expect "the words in the fail colour (a red, not a grey or an ink)" "$(js "() => { const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true }); c.fillStyle = getComputedStyle(document.querySelector('.broken [role=status]')).color; c.fillRect(0, 0, 1, 1); const [r, g, b] = c.getImageData(0, 0, 1, 1).data; return r > g + 50 && r > b + 30 ? 'fail colour' : 'rgb ' + [r, g, b]; }")" '^fail colour$'
expect "with the diamond" "$(js "() => getComputedStyle(document.querySelector('.broken'), '::before').content !== 'none' || getComputedStyle(document.querySelector('.broken [role=status]'), '::before').content !== 'none' ? 'diamond' : 'no diamond'")" '^diamond$'
expect "the parser's position detail follows, in soft ink" "$(js "() => { const d = document.querySelector('.broken .quiet'); const probe = document.createElement('i'); probe.style.color = 'var(--ink-soft)'; document.body.append(probe); const want = getComputedStyle(probe).color; probe.remove(); return d && d.textContent.length > 0 && getComputedStyle(d).color === want ? 'soft' : 'not soft'; }")" '^soft$'
shot floor-problem-light-1440
if [ -n "$shots" ]; then
  theme Dark
  shot floor-problem-dark-1440
  theme Light
fi

playwright-cli -s="$session" console error > "$work/console.log" 2>&1
grep -E "^\[ERROR\]" "$work/console.log" > "$work/errors.log"
[ -s "$work/errors.log" ] && fail "the page logged an error: $(cat "$work/errors.log")"
kill "$server" 2> /dev/null
playwright-cli -s="$session" close > /dev/null 2>&1
echo "floor-words: ok"
