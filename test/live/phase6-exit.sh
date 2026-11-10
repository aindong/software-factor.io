#!/bin/bash
# The exit check of phase 6, printed: the eval passes every seeded case and fails with one gate
# broken on purpose; the cost report matches the session records; one lane is moved up on its
# record and moved back by an escape. All on the scripted agent: it costs nothing.
# Usage: bash test/live/phase6-exit.sh      (needs a built command: pnpm run build)
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
[ -f "$here/dist/cli.js" ] || fail "build first: pnpm run build"
sf() { node "$here/dist/cli.js" "$@"; }
edit() { node -e 'const fs = require("fs"); const [f, code] = process.argv.slice(1); const j = JSON.parse(fs.readFileSync(f)); new Function("j", code)(j); fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");' "$@"; }
last_run() { node -e 'const { DatabaseSync } = require("node:sqlite"); const r = new DatabaseSync(".factor/state.db", { readOnly: true }).prepare("select id, status from runs order by started_at desc, rowid desc limit 1").get(); console.log(r.id, r.status);'; }
clean_run() { # one run to the end, approved as it is wherever it waits
  sf run > /dev/null 2>&1
  for _ in 1 2 3; do
    set -- $(last_run)
    [ "$2" = waiting ] && sf approve "$1" > /dev/null 2>&1
  done
  set -- $(last_run)
  [ "$2" = done ] || fail "a run did not end done: $2"
  echo "$1"
}
export FACTOR_HOME="$work/home"

echo "== 1. the eval passes every seeded case"
out=$(sf eval); status=$?
echo "$out" | tail -1
[ "$status" -eq 0 ] || fail "eval exited $status"
echo "$out" | grep -Eq '^([0-9]+) of \1 cases passed \(100%\)$' || fail "not every case passed"

echo "== 2. with one gate broken on purpose, it fails"
out=$(sf eval --break core/tests-not-weakened@1); status=$?
echo "$out" | grep -E '^FAIL|cases passed'
[ "$status" -eq 1 ] || fail "eval with a broken gate exited $status"

echo "== 3. the cost report matches the session records"
mkdir -p "$work/shop" && cd "$work/shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# shop" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
edit .factor/factory.json 'j.ladder = { runs: 2 }; j.commands.verify = "true"'
# the scripted agent says what it used, so that there is something to add up
edit .factor/local.json 'const s = j.roles.author.script; for (const lane of Object.keys(s)) s[lane] = [{ usage: { tokens: 1234, usd: 0.05 } }, ...s[lane]];'
printf -- '- [ ] First\n- [ ] Second\n- [ ] Third\n' > .factor/tasks.md
git add -A && git commit -q -m "a factory"
clean_run > /dev/null
clean_run > /dev/null
sf cost || fail "cost"
sf cost --check || fail "the report does not match the session records"
node -e 'const { DatabaseSync } = require("node:sqlite"); const r = new DatabaseSync(".factor/state.db", { readOnly: true }).prepare("select lane, count(*) as sessions, sum(tokens) as tokens from sessions group by lane").all(); console.log("the session rows:", JSON.stringify(r));'

echo "== 4. a lane is moved up on its record, and moved back by an escape"
sf ladder
sf ladder | grep -q "it can move near the loop" || fail "no step was earned after two clean runs"
sf ladder accept work || fail "accept"
grep -q '"checkpoint": "near"' .factor/workflows/starter.json || fail "the lane did not move near the loop"
git add -A && git commit -q -m "work moves near the loop"
run=$(clean_run)
sf escape "$run" --lane work --note "The export button was left out of the page" || fail "escape"
grep -q '"checkpoint": "in"' .factor/workflows/starter.json || fail "the escape did not move the lane back"
sf ladder
echo "phase 6 exit: ok"
