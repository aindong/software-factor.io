#!/bin/bash
# The factory's runs on its own repository, opened in the interface in a real browser: for each
# run that ended done, the run's page with its lanes, and with one piece of evidence open. It
# asserts what the page shows (the task, "Done.", every lane that ran, a gate's record opened in
# place) and keeps a screenshot of each. Reading only: it presses keys and changes nothing.
# Usage: bash test/live/dogfood-evidence.sh <folder for screenshots>
#   (in the workspace, with FACTOR_HOME set as for its runs; needs playwright-cli and a build)
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:?give a folder for the screenshots}
work=$(mktemp -d)
session="dogfood-$$"
server=""
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"
[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
mkdir -p "$shots"

runs=$(node -e 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(".factor/state.db", { readOnly: true }); for (const r of db.prepare("select r.id, t.title from runs r join tasks t on t.id = r.task_id where r.status = ? order by r.started_at").all("done")) console.log(r.id);')
[ -n "$runs" ] || fail "no run of this workspace has ended done"

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
base=${address%%#*}
for run in $runs; do
  lanes=$(node -e 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(".factor/state.db", { readOnly: true }); console.log(db.prepare("select count(*) as n from lane_runs where run_id = ?").get(process.argv[1]).n);' "$run")
  pw goto "${base}runs/$run#${address#*#}" || fail "the run's page did not open"
  wait_for "run $run is on the page" "() => location.pathname" "^/runs/$run\$"
  wait_for "each of its $lanes lane visits is listed" "() => document.querySelectorAll('.visits > li').length" "^$lanes\$"
  wait_for "it says the run is done" "() => document.querySelector('.rundetail')?.textContent ?? ''" 'Done.*Finished: every lane passed'
  pw screenshot --filename="$shots/run-$run.png"
  # the record of a gate that passed, opened in place by keyboard
  # a lane's gates are inside its evidence: open each lane's by keyboard until the gate shows
  for _ in $(seq 1 200); do
    pw press Tab
    now=$(js "$focused")
    expanded=$(js "() => document.activeElement.getAttribute('aria-expanded') ?? ''")
    echo "$now" | grep -Eq '^Gate verify passed' && break
    if echo "$now" | grep -Eq '^Evidence for' && [ "$expanded" = "false" ]; then pw press Enter; fi
  done
  echo "$(js "$focused")" | grep -Eq '^Gate verify passed' || fail "Tab never reached the gate's record"
  pw press Enter
  wait_for "a gate's record is open, with the command the gate ran" "() => [...document.querySelectorAll('.proof button[aria-expanded=true]')].map((b) => b.closest('.proof').textContent).join(' ').slice(0, 4000)" 'pnpm run typecheck'
  pw screenshot --filename="$shots/run-$run-evidence.png"
  echo "ok: run $run, $lanes lane visits, evidence open"
done
pw close
kill "$server" 2> /dev/null
echo "dogfood evidence: ok"
