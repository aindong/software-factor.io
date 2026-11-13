#!/bin/bash
# The lane map of a workflow with conditional routes ("pass if"), as the Inbox draws it, seen on the
# Floor in both themes at desk and at phone width: no text of the map meets another, no route
# crosses a lane's name or role line, and no text leaves the map's box. Needs playwright-cli and a
# built command (pnpm run build). The page is driven by keys and then read.
# Usage: bash test/ui/maps.sh [folder for screenshots]
# Prints "maps: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="maps-$$"
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
rm -f .factor/workflows/starter.json
node -e '
const fs = require("fs");
const from = (id) => ({ id, uses: "core/file@1", with: { path: ".factor/" + id + ".md" } });
const via = (source) => ({ ref: "task.source", in: [source] });
const end = { pass: "@done", fail: "@stop" };
const workflow = {
  $schema: "https://softwarefactor.io/schema/workflow/v1.json",
  version: 1,
  name: "delivery",
  description: "Sort a task by where it came from, then build, ship or ask.",
  roles: { author: { description: "Writes." } },
  limits: { minutes: 60, tokens: 1000000 },
  commands: { verify: { description: "The tests." } },
  collectors: ["builds", "ships", "questions", "slow"].map(from),
  lanes: [
    { id: "sort", name: "Sort", uses: "core/command@1", with: { run: "true" }, checkpoint: "out",
      on: { pass: [{ to: "ask", when: via("questions") }, { to: "ship", when: via("ships") }, { to: "slow", when: via("slow") }, { to: "build" }], fail: "@stop" } },
    { id: "build", name: "Build", uses: "core/agent@1", agent: { role: "author", access: "read", prompt: "Build it." }, checkpoint: "in", on: end },
    { id: "ship", name: "Ship it", uses: "core/command@1", with: { run: "true" }, checkpoint: "in", on: end },
    { id: "ask", name: "Plan", uses: "core/agent@1", agent: { role: "author", access: "read", prompt: "Plan it." }, checkpoint: "out", on: end },
    { id: "slow", name: "Reindex", uses: "core/command@1", with: { run: "sleep 60" }, checkpoint: "out", on: end },
  ],
};
fs.writeFileSync(".factor/workflows/delivery.json", JSON.stringify(workflow, null, 2));
const f = JSON.parse(fs.readFileSync(".factor/factory.json"));
fs.writeFileSync(".factor/factory.json", JSON.stringify({ ...f, workflow: "delivery", commands: { verify: "true" } }, null, 2));
'
echo "- [ ] Publish the release" > .factor/ships.md
git add -A && git commit -q -m "set up the factory"
sf check > "$work/check.log" 2>&1 || fail "the workflow does not pass the checker: $(cat "$work/check.log")"

sf run > "$work/run.log" 2>&1; [ $? -eq 3 ] || fail "the run should wait for a person: $(cat "$work/run.log")"
start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
wait_for "the workflow is drawn" "() => document.querySelectorAll('.station.lane').length" '^5$'
expect "the map has its conditional routes" "$(js "() => document.querySelectorAll('svg.map .line.conditional').length")" '^3$'
wait_for "the run that waits is a train on the map" "() => document.querySelectorAll('g.train').length" '^1$'
expect "the map is drawn up to the canvas, at most 1.5 times its natural size" "$(js "$map_fill")" '^fills$'
expect "each task badge has a hit area of at least 24 by 24 px at desk width" "$(hits 'g.train .hit' 24 24)" '^ok$'
centres_free "the conditional map at 1440"
shot maps-light-1440
labels_apart "the conditional map, light at 1440"
names_belong "the conditional map, light at 1440"
theme Dark
shot maps-dark-1440
labels_apart "the conditional map, dark at 1440"
pw resize 390 844
wait_for "the map is drawn at phone width" "() => document.querySelectorAll('.station.lane').length" '^5$'
labels_apart "the conditional map, dark at 390"
theme Light
labels_apart "the conditional map, light at 390"
expect "at phone width the map is drawn as it was, and scrolls" "$(js "() => { const m = document.querySelector('.map-scroll svg.map'); return Math.abs(m.getBoundingClientRect().width - m.viewBox.baseVal.width) <= 1 ? 'natural' : 'scaled'; }")" '^natural$'
expect "each task badge has a hit area of at least 44 by 44 px at phone width" "$(hits 'g.train .hit' 44 44)" '^ok$'
expect "every station of the Floor is 44 px wide at least" "$(hits '.station .hit' 44 1)" '^ok$'
centres_free "the conditional map at 390"
# a run's own map, at phone width: every station is at least 44 px wide to touch
section Runs
tab_to 'Publish the release'
pw press Enter
wait_for "the run's map is drawn" "() => document.querySelectorAll('svg.map.overlaid .station').length" '^[1-9]'
expect "every station of a run's map is 44 px wide at least" "$(hits 'svg.map.overlaid .station .hit' 44 1)" '^ok$'
centres_free "the run's map at 390"

playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "maps: ok"
