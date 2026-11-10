#!/bin/bash
# Live: the real gh on this machine, reading the open issues of a public repository by label
# into a throwaway workspace. Read only: nothing is posted, changed or created on GitHub.
# Usage: bash test/live/collect-github.sh [owner/repo] [label]   (default: cli/cli, bug)
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
repo=${1:-cli/cli}
label=${2:-bug}
work=$(mktemp -d)
export FACTOR_HOME="$work/home"
fail() { echo "FAIL: $*"; exit 1; }
[ -f "$here/dist/cli.js" ] || fail "build first: pnpm run build"
gh --version > /dev/null 2>&1 || fail "gh is not installed"
sf() { node "$here/dist/cli.js" "$@"; }

mkdir -p "$work/shop" && cd "$work/shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
f=.factor/workflows/$(node -e 'console.log(JSON.parse(require("fs").readFileSync(".factor/factory.json")).workflow)').json
node -e 'const fs = require("fs"); const [f, repo, label] = process.argv.slice(1); const w = JSON.parse(fs.readFileSync(f)); w.collectors = [{ id: "issues", uses: "core/github-issues@1", with: { label, repo } }]; fs.writeFileSync(f, JSON.stringify(w, null, 2) + "\n");' "$f" "$repo" "$label"
sf check > "$work/check.log" 2>&1 || fail "the workflow does not pass the checker: $(cat "$work/check.log")"
out=$(sf collect) || fail "collect exited with an error: $out"
echo "$out"
echo "$out" | grep -Eq '^collected [1-9][0-9]* new tasks?$' || fail "no task was collected from $repo with the label $label"
node -e 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(".factor/state.db", { readOnly: true }); const rows = db.prepare("select key, title, labels from tasks order by id limit 3").all(); for (const r of rows) console.log(r.key, "|", r.title.slice(0, 70), "|", r.labels); if (!rows.every((r) => /^#[0-9]+$/.test(r.key) && r.title && JSON.parse(r.labels).includes(process.argv[1]))) process.exit(1);' "$label" || fail "a task does not have an issue number, a title and the label"
again=$(sf collect)
[ "$again" = "collected 0 new tasks" ] || fail "a second collect added tasks again: $again"
echo "live github collect: ok ($repo, label $label)"
