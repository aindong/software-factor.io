#!/bin/bash
# The marks on a map's stations: a station takes the same focus mark in every state (a lane that is
# selected, one just added), a lane a person stopped shows its neutral bar, and a task badge keeps
# 6 px clear of every line's label, for each shipped workflow and the starter, at desk and phone width.
# Driven by keys and then read. Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/map-marks.sh [folder for screenshots]
# Prints "map-marks: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="marks-$$"
server=""
slow=""
cleanup='[ -n "$slow" ] && kill "$slow" 2> /dev/null'
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
starter=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(".factor/factory.json")).workflow)')
cp "$here"/workflows/*.json .factor/workflows/
workflow() { # the workflow the Floor shows
  node -e 'const fs = require("fs"); const f = JSON.parse(fs.readFileSync(".factor/factory.json")); f.workflow = process.argv[1]; fs.writeFileSync(".factor/factory.json", JSON.stringify(f, null, 2));' "$1"
}

# where a task's badge stands at each station is on the station (data-badge: sideways and down, in map units from it): no label of a line may come within 6 px of it
badge_clear='() => {
  const out = [];
  const tags = [...document.querySelectorAll("svg.map text.tag")].map((t) => ({ t: t.textContent, r: t.getBoundingClientRect() }));
  for (const g of document.querySelectorAll("svg.map .station.lane")) {
    const hit = g.querySelector(".hit").getBoundingClientRect();
    const svg = g.ownerSVGElement;
    const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    const [dx, dy] = g.dataset.badge.split(" ").map(Number);
    const [cx, cy] = [hit.left + hit.width / 2 + dx * scale, hit.top + hit.height / 2 + dy * scale];
    const badge = [cx - 17 * scale - 6, cy - 9 * scale - 6, cx + 17 * scale + 6, cy + 9 * scale + 6];
    for (const { t, r } of tags) if (r.left < badge[2] && badge[0] < r.right && r.top < badge[3] && badge[1] < r.bottom) out.push(g.getAttribute("aria-label").split(",")[0] + " / " + t);
  }
  return out.length ? out.join("; ") : "clear";
}'
start_ui 0
pw open "$address" || fail "the browser did not open"
for name in "$starter" bugfix-fast full-loop research-only; do
  workflow "$name"
  for width in 1440 390; do
    pw resize "$width" 900
    pw reload
    wait_for "$name is drawn at $width" "() => document.querySelectorAll('.station.lane').length" '^[1-9]'
    expect "$name at $width: a task badge keeps 6 px from every label of a line" "$(js "$badge_clear")" '^clear$'
    unpainted "$name at $width"
  done
done
pw resize 1440 900
workflow "$starter"
pw reload
wait_for "the starter is drawn" "() => document.querySelectorAll('.station.lane').length" '^[1-9]'

# ---- 1. a station shows its focus mark whatever its state: focused or not, the picture differs
mark='() => { const g = document.activeElement.closest(".station") ?? document.querySelector(".station[aria-pressed=true]"); return [...g.querySelectorAll("*")].map((e) => { const c = getComputedStyle(e); return c.opacity + c.stroke + c.strokeWidth + c.visibility; }).join("|"); }'
focus_shows() { # <what>: the station that has the keyboard looks different from the same station without it
  local on off
  on=$(js "$mark")
  pw press Tab
  off=$(js "$mark")
  pw press Shift+Tab
  [ "$on" != "$off" ] || fail "$1: the focused station looks the same as when the keyboard is elsewhere"
}
back_to '^Add a lane$'
pw press Enter
tab_to '^Agent$'
pw press Enter
wait_for "a lane is added and selected" "() => document.querySelectorAll('.station.lane[aria-pressed=true]').length" '^1$'
back_to '^Lane lane,'
focus_shows "the lane just added"
shot map-marks-new-light-1440
for _ in $(seq 1 6); do
  pw press ArrowLeft
  focus_shows "$(js "$focused")"
done
for _ in $(seq 1 12); do
  pw press ArrowRight
  focus_shows "$(js "$focused")"
done

# ---- 2. a lane that a person stopped has its bar, in the neutral colours
cat > .factor/workflows/delivery.json << 'FLOW'
{
  "$schema": "https://softwarefactor.io/schema/workflow/v1.json",
  "version": 1,
  "name": "delivery",
  "description": "Build.",
  "roles": { "author": { "description": "Writes." } },
  "limits": { "minutes": 60, "tokens": 1000000 },
  "collectors": [{ "id": "tasks", "uses": "core/file@1", "with": { "path": ".factor/tasks.md" } }],
  "lanes": [
    { "id": "build", "name": "Build", "uses": "core/agent@1", "agent": { "role": "author", "access": "read", "prompt": "Build it." }, "checkpoint": "out", "on": { "pass": "@done", "fail": "@stop" } }
  ]
}
FLOW
node -e '
const fs = require("fs");
const f = JSON.parse(fs.readFileSync(".factor/factory.json"));
fs.writeFileSync(".factor/factory.json", JSON.stringify({ ...f, workflow: "delivery" }, null, 2));
fs.writeFileSync(".factor/tasks.md", "- [ ] Slow task\n");
const build = [{ sleep: 120000 }, { handoff: { outcome: "pass", summary: "Built it." } }];
fs.writeFileSync(".factor/local.json", JSON.stringify({ roles: { author: { adapter: "fake", script: { build } } } }, null, 2));
'
git add -A && git commit -q -m "set up the factory"
sf run > "$work/run.log" 2>&1 &
slow=$!
for _ in $(seq 1 100); do [ "$(sf runs 2> /dev/null | grep -c running)" -ge 1 ] && break; sleep 0.2; done
id=$(sf runs 2> /dev/null | awk 'NR == 1 { print $1 }')
[ -n "$id" ] || fail "no run id in: $(sf runs 2>&1)"
sleep 2
sf stop "$id" > "$work/stop.log" 2>&1 || fail "stop: $(cat "$work/stop.log")"
wait "$slow" 2> /dev/null
slow=""
section Runs
tab_to '[0-9]+ Slow task'
pw press Enter
wait_for "the run's map is drawn" "() => document.querySelectorAll('svg.map.overlaid .station.ran-stopped').length" '^1$'
bar='() => { const g = document.querySelector("svg.map .station.ran-stopped"); const [body, mark] = ["body", "mark"].map((c) => getComputedStyle(g.querySelector("." + c))); const ground = getComputedStyle(document.body).backgroundColor; const ink = getComputedStyle(document.body).color; return (body.fill === ground ? "ground" : "fill " + body.fill) + " " + (body.stroke === ink ? "ink" : "outline " + body.stroke) + " " + (mark.stroke === ink ? "ink" : "bar " + mark.stroke); }'
expect "the lane a person stopped is a ground disc with an ink outline and an ink bar" "$(js "$bar")" '^ground ink ink$'
shot map-marks-stopped-light-1440

playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "map-marks: ok"
