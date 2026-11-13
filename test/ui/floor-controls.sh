#!/bin/bash
# The Floor's controls and its first read (round two): the count that waits for a person has the yellow square the
# Runs list uses, and none when nothing waits (F5); the Diagram and JSON switch is quiet when selected, so Save is
# the one ink fill, and its halves are 44 px high at phone width (F6); every select of the lane panel is one kind
# (F7); Undo after a save says what it undoes or is off (F16); the working run's link is a target of 24 px at desk
# width and 44 at phone width (F12). One run waits at its checkpoint, one works, one task is queued.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/floor-controls.sh [folder for screenshots]
# Prints "floor-controls: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="floor-controls-$$"
server=""
slow=""
cleanup='[ -n "$slow" ] && kill "$slow" 2> /dev/null'
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
for name in $(env | sed -nE 's/^(FACTOR_[A-Za-z0-9_]*)=.*/\1/p'); do unset "$name"; done
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }

# ---- a workspace: build, then review, then ship on approval; the reviewer's script is set before each run
mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
cat > .factor/workflows/delivery.json << 'FLOW'
{
  "$schema": "https://softwarefactor.io/schema/workflow/v1.json",
  "version": 1,
  "name": "delivery",
  "description": "Build, review and ship on approval.",
  "roles": { "author": { "description": "Writes." }, "reviewer": { "description": "Reads." } },
  "limits": { "minutes": 60, "tokens": 1000000 },
  "commands": { "verify": { "description": "The tests." } },
  "collectors": [{ "id": "tasks", "uses": "core/file@1", "with": { "path": ".factor/tasks.md" } }],
  "gates": { "verify": { "uses": "core/command@1", "with": { "command": "verify" }, "onFail": "fail" } },
  "lanes": [
    { "id": "build", "name": "Build", "uses": "core/agent@1", "agent": { "role": "author", "access": "write", "prompt": "Build it." }, "gates": ["verify"], "checkpoint": "out", "on": { "pass": "review", "fail": "@stop" } },
    { "id": "review", "name": "Review", "uses": "core/agent@1", "agent": { "role": "reviewer", "access": "read", "prompt": "Review it." }, "checkpoint": "out", "on": { "pass": "ship", "fail": "@stop" } },
    { "id": "ship", "name": "Ship it", "uses": "core/command@1", "with": { "run": "true" }, "checkpoint": "in", "on": { "pass": "@done", "fail": "@stop" } }
  ]
}
FLOW
rm -f .factor/workflows/starter.json
node -e '
const fs = require("fs");
const f = JSON.parse(fs.readFileSync(".factor/factory.json"));
fs.writeFileSync(".factor/factory.json", JSON.stringify({ ...f, workflow: "delivery", commands: { verify: "true" } }, null, 2));
fs.writeFileSync(".factor/tasks.md", "- [ ] Add an export button\n- [ ] Fix the date format\n- [ ] Show the cost of each lane\n");
'
script() { # script <milliseconds the reviewer works>
  node -e '
const [ms] = process.argv.slice(1);
const roles = {
  author: { adapter: "fake", script: { build: [{ write: { path: "src/a.ts", content: "export {};\n" } }, { commit: "Add a" }, { handoff: { outcome: "pass", summary: "Built." } }] } },
  reviewer: { adapter: "fake", script: { review: [...(Number(ms) ? [{ sleep: Number(ms) }] : []), { handoff: { outcome: "pass", summary: "Read it." } }] } },
};
require("fs").writeFileSync(".factor/local.json", JSON.stringify({ roles }, null, 2));
' "$1"
  git add -A && git commit -q -m "set up the factory" > /dev/null 2>&1
}
# one run waits for approval, one works, the third task is queued
script 0
sf run > "$work/run1.log" 2>&1; [ $? -eq 3 ] || fail "the first run should wait for approval: $(cat "$work/run1.log")"
waiting=$(sf runs 2> /dev/null | awk 'NR == 1 { print $1 }')
[ -n "$waiting" ] || fail "no run id in: $(sf runs 2>&1)"
script 900000 # the checks below take minutes, and the run must still work at the last of them
sf run > "$work/run2.log" 2>&1 &
slow=$!

needs='() => document.querySelector(".topbar .needs")?.textContent ?? "no line"'
start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
wait_for "the line of counts says what waits, works and is queued" "$needs" '^1 waits for you · 1 queued$'
wait_for "the strip names the working run" "() => document.querySelectorAll('.queue li.working').length" '^1$'

# ---- F5: the count that waits for a person is the first read of the bar: a yellow square, ink, weight 600
mark='() => { const a = document.querySelector(".topbar .needs a[href=\"/inbox\"]"); const m = a?.querySelector(".mark.asked"); if (!a || !m) return "no mark"; const rest = [...document.querySelectorAll(".topbar .needs a:not([href=\"/inbox\"])")].some((x) => x.querySelector(".mark")); return getComputedStyle(a).fontWeight + (rest ? " other counts marked" : " only this one"); }'
expect "the count that waits for a person has the yellow square, weight 600, and no other count has a mark" "$(js "$mark")" '^600 only this one$'
expect "the yellow square is the signal yellow the Runs list uses" "$(js "() => { const m = document.querySelector('.topbar .needs .mark.asked'); const p = document.createElement('i'); p.style.background = 'var(--signal)'; document.body.append(p); const want = getComputedStyle(p).backgroundColor; p.remove(); return m && getComputedStyle(m).backgroundColor === want ? 'signal' : 'not signal'; }")" '^signal$'
pw resize 390 844
expect "at phone width the mark is there too" "$(js "() => document.querySelectorAll('.topbar .needs .mark.asked').length")" '^1$'
pw resize 1440 900

# ---- F12: the working run's link in the strip is a target of 24 px at desk width and 44 at phone width, by hit area
link='() => { const r = document.querySelector(".queue li.working a").getBoundingClientRect(); return Math.round(r.width) + "x" + Math.round(r.height); }'
expect "at desk width the working run's link is at least 24 px high" "$(js "$link")" '^[0-9]+x(2[4-9]|[3-9][0-9])$'
pw resize 390 844
expect "at phone width it is at least 44 px high" "$(js "$link")" '^[0-9]+x(4[4-9]|[5-9][0-9])$'
pw resize 1440 900

# ---- F6: the switch's selected half is quiet (panel fill, ink text at 600, a 2px ink line under it), so with a
# change pending Save is the one ink fill; the halves are 44 px high at phone width
tab_to '^Lane Build'
pw press Enter
tab_to '^Instructions'
pw type " Say what could break."
expect "a change is pending" "$(js "() => document.querySelector('.topbar .status').textContent")" '^Not saved$'
loud='() => [...document.querySelectorAll("button, a.button, [role=button]")].filter((b) => !b.disabled && b.getClientRects().length > 0 && getComputedStyle(b).backgroundColor === getComputedStyle(document.querySelector(".button.primary")).backgroundColor).map((b) => b.textContent.trim()).join(" | ")'
selected='() => { const b = document.querySelector(".segmented button[aria-pressed=true]"); const o = document.querySelector(".segmented button[aria-pressed=false]"); const c = getComputedStyle(b), q = getComputedStyle(o), root = getComputedStyle(document.body); return [c.fontWeight, c.borderBottomWidth, c.borderBottomColor === c.color ? "line in ink" : "line " + c.borderBottomColor, c.backgroundColor === getComputedStyle(document.querySelector(".inspector")).backgroundColor ? "panel" : "not panel", q.fontWeight, q.borderBottomWidth, q.color === c.color ? "same colour" : "softer"].join(" "); }'
pw resize 1440 900
expect "the selected half: weight 600, a 2px ink line, panel fill; the other: 400, no line, softer ink" "$(js "$selected")" '^600 2px line in ink panel 400 0px softer$'
expect "at desk width Save is the only ink fill" "$(js "$loud")" '^Save$'
pw resize 390 844
expect "at phone width Save is the only ink fill" "$(js "$loud")" '^Save$'
back_to '^Tools$'
pw press Enter
expect "at phone width each half of the switch is at least 44 px high" "$(js "() => [...document.querySelectorAll('.segmented button')].every((b) => b.getBoundingClientRect().height >= 43.5)")" '^true$'
pw resize 1440 900

# ---- F7: the eight selects of an agent lane's panel are one kind: drawn by the page, one chevron, one corner, one height
kinds='() => { const s = [...document.querySelectorAll(".inspector select")]; const look = (e) => { const c = getComputedStyle(e); return [c.appearance, c.borderRadius, Math.round(e.getBoundingClientRect().height), c.backgroundImage.includes("linear-gradient") ? "chevron" : "native arrow", c.paddingRight].join(" "); }; const kinds = [...new Set(s.map(look))]; return s.length + " selects, " + kinds.length + " look(s): " + kinds.join(" / "); }'
expect "all eight selects of the lane panel look alike" "$(js "$kinds")" '^8 selects, 1 look\(s\): '

# ---- F16: after a save Undo says what it undoes (the last edit, which the file keeps until it is saved again), or is off
back_to '^Save$'
pw press Enter
wait_for "the change is saved" "() => document.querySelector('.topbar .status').textContent" '^Saved'
undo='() => { const b = [...document.querySelectorAll(".topbar .group button")].find((x) => /^Undo/.test(x.textContent)); return !b ? "no Undo button" : b.disabled ? "off" : b.textContent.trim(); }'
expect "after a save Undo is off or says what it undoes" "$(js "$undo")" '^(off|Undo last edit)$'

# ---- the end: nothing waits, so no yellow in the line of counts
sf approve "$waiting" > "$work/approve.log" 2>&1 || fail "approve: $(cat "$work/approve.log")"
wait_for "nothing waits any more" "$needs" '^1 queued$|^no line$'
expect "when nothing waits there is no yellow in the line of counts" "$(js "() => document.querySelectorAll('.topbar .needs .mark.asked').length")" '^0$'

playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
kill "$slow" 2> /dev/null
echo "floor-controls: ok"
