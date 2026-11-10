#!/bin/bash
# The factory floor in a real browser, by keyboard: the steps of the plan's browser check, kept so
# that they can be run again. Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/floor.sh [folder for screenshots]
# Prints "floor: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="floor-$$"
server=""

fail() {
  echo "FAIL: $1"
  playwright-cli -s="$session" close > /dev/null 2>&1
  [ -n "$server" ] && kill "$server" 2> /dev/null
  exit 1
}
pw() { playwright-cli -s="$session" "$@" > "$work/pw.log" 2>&1; }
# the value a script returns in the page, as text
js() {
  playwright-cli -s="$session" eval "$1" 2> /dev/null | awk 'found { print; exit } /^### Result/ { found = 1 }' | sed -e 's/^"//' -e 's/"$//'
}
expect() { # expect <what> <got> <wanted pattern>
  echo "$2" | grep -Eq "$3" || fail "$1: got \"$2\", wanted /$3/"
}
focused='() => { const a = document.activeElement; return a?.getAttribute("aria-label") || a?.textContent || a?.tagName || ""; }'
shot() {
  [ -n "$shots" ] || return 0
  mkdir -p "$shots"
  pw screenshot --filename="$shots/$1.png" || fail "screenshot $1"
}
theme() { js "() => { document.documentElement.setAttribute('data-theme', '$1'); return '$1'; }" > /dev/null; }
view() { js "() => { [...document.querySelectorAll('.segmented button')].find((b) => b.textContent === '$1').click(); return '$1'; }" > /dev/null; }
put_json() { # replace text in the JSON view, as typing or pasting would
  js "() => { const area = document.querySelector('.json textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(area, area.value.replace($1, $2)); area.dispatchEvent(new Event('input', { bubbles: true })); return 'typed'; }" > /dev/null
}

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
sf() { FACTOR_HOME="$work/home" node "$here/dist/cli.js" "$@"; }

# a workspace with the default workflow
mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
cp "$here/workflows/alleo-loop.json" .factor/workflows/
node -e 'const fs = require("fs"); const f = JSON.parse(fs.readFileSync(".factor/factory.json")); f.workflow = "alleo-loop"; fs.writeFileSync(".factor/factory.json", JSON.stringify(f, null, 2));'
file=.factor/workflows/alleo-loop.json

sf ui --port 0 > "$work/ui.log" 2>&1 &
server=$!
for _ in $(seq 1 50); do grep -q "#t=" "$work/ui.log" && break; sleep 0.1; done
address=$(grep -o 'http://127.0.0.1:[0-9]*/#t=[0-9a-f]*' "$work/ui.log") || fail "the interface did not start: $(cat "$work/ui.log")"

pw open "$address" || fail "the browser did not open"
pw resize 1440 900
grep -q "Console: [1-9]" "$work/pw.log" && fail "the page logged an error: $(cat "$work/pw.log")"
expect "the key is taken out of the address bar" "$(js '() => location.href')" '^http://127\.0\.0\.1:[0-9]+/$'
shot floor-light-1440

# 1. by keyboard: Tab into the map, arrows along it, Enter opens a station
for _ in $(seq 1 24); do
  pw press Tab
  case "$(js "$focused")" in Lane*) break ;; esac
done
expect "Tab reaches the first station" "$(js "$focused")" '^Lane Plan, author, waits for a person$'
pw press ArrowRight && pw press ArrowRight
expect "the arrow keys move along the map" "$(js "$focused")" '^Lane Impact, author$'
pw press Enter
expect "Enter opens the station in the inspector" "$(js "$focused")" '^Lane Impact$'
shot lane-open-light-1440

# 2. add a lane after it, and connect its fail outcome back, with c
js "() => { [...document.querySelectorAll('.topbar .button')].find((b) => b.textContent === 'Agent').focus(); return 'focused'; }" > /dev/null
pw press Enter
expect "a lane is placed after the selected one" "$(js "() => [...document.querySelectorAll('.station.lane')].map((s) => s.getAttribute('aria-label').replace('Lane ', '').split(',')[0]).join(' > ')")" 'Impact > lane > Review'
expect "the workflow is not saved yet" "$(js "() => document.querySelector('.status').textContent")" '^Not saved$'
js "() => { document.querySelector('.station[aria-pressed=true]').focus(); return 'focused'; }" > /dev/null
pw press c
expect "c puts the keyboard on where the lane goes" "$(js "$focused")" '^When this lane passes, go to$'
pw press Tab
expect "the next control is the fail outcome" "$(js "$focused")" '^When this lane fails, go to$'
js "() => { const s = document.activeElement; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'impact'); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; }" > /dev/null
expect "a connection that goes back gets a round limit" "$(js "() => [...document.querySelectorAll('.inspector .note')].map((n) => n.textContent).join(' ')")" 'at most 2 times, then stops'
shot lane-added-and-connected

# 3. the same change is in the JSON view, and a change there shows on the map
view JSON
expect "the JSON view holds the new lane" "$(js "() => { const t = document.querySelector('.json textarea').value; return [t.includes('\"id\": \"lane\"'), t.includes('\"maxRounds\": 2')].join(' '); }")" '^true true$'
put_json "'\"name\": \"Impact\"'" "'\"name\": \"Blast radius\"'"
shot json-light-1440
view Diagram
expect "the map follows the JSON" "$(js "() => [...document.querySelectorAll('.station.lane .name')].map((n) => n.textContent).join(' > ')")" 'Build > Blast radius > lane > Review'

# 4. a problem is listed with its place and its fix, and Save is off
js "() => { document.querySelector('.station[aria-label^=\"Lane lane\"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); const s = document.querySelector('select[aria-label=\"When this lane passes, go to\"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ''); s.dispatchEvent(new Event('change', { bubbles: true })); return 'unset'; }" > /dev/null
expect "the status counts the problem" "$(js "() => document.querySelector('.status').textContent")" '^1 problem$'
expect "the problem has its place and its fix" "$(js "() => document.querySelector('.problems li').innerText.replace(/\\n/g, ' | ')")" 'lanes\[3\]\.on\.pass \| .+ \| .*required'
expect "Save is off while there is a problem" "$(js "() => String(document.querySelector('.button.primary').disabled)")" '^true$'
shot problem-with-its-fix
js "() => { const s = document.querySelector('select[aria-label=\"When this lane passes, go to\"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'review'); s.dispatchEvent(new Event('change', { bubbles: true })); return 'set'; }" > /dev/null

# 5. a save the server refuses says why
view JSON
put_json "'\"name\": \"alleo-loop\"'" "'\"name\": \"other-name\"'"
pw press Control+s
sleep 0.4
expect "a refused save says why" "$(js "() => document.querySelector('.status').textContent")" '^Not saved: .*other-name'
put_json "'\"name\": \"other-name\"'" "'\"name\": \"alleo-loop\"'"

# 6. save by keyboard: the file is written, and the checker accepts it
pw press Control+s
sleep 0.4
expect "the save is confirmed" "$(js "() => document.querySelector('.status').textContent")" '^Saved'
grep -q '"name": "Blast radius"' "$file" || fail "the file on disk does not hold the change"
grep -q '"id": "lane"' "$file" || fail "the file on disk does not hold the new lane"
sf check > "$work/check.log" 2>&1 || fail "the saved workflow does not pass the checker: $(cat "$work/check.log")"

# 7. both themes, at desktop and at phone width
view Diagram
theme dark && shot floor-dark-1440
view JSON && shot json-dark-1440
view Diagram
pw resize 390 844
expect "the map scrolls and does not reflow at phone width" "$(js "() => [document.documentElement.scrollWidth <= 390, document.querySelector('.map-scroll').scrollWidth > 390].join(' ')")" '^true true$'
js "() => { document.querySelector('.inspector .close')?.click(); return 'closed'; }" > /dev/null
shot floor-dark-390
theme light && shot floor-light-390
js "() => { document.querySelector('.station[aria-label^=\"Lane Build\"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return 'open'; }" > /dev/null
expect "a station opens as a sheet at phone width" "$(js "() => document.querySelector('.inspector').dataset.open")" '^true$'
shot sheet-light-390
theme dark && shot sheet-dark-390

playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "floor: ok"
