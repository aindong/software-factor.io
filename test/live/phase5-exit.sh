#!/bin/bash
# The exit check of phase 5, printed: a plugin installs with `softwarefactor add`, a GitHub-issue
# task is collected with the real gh (read only), and an exported workflow imports and runs in a
# clean folder; then a search of the export for a secret and for an account name.
# Usage: bash test/live/phase5-exit.sh      (needs a built command: pnpm run build, and gh signed in)
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
fail() { echo "FAIL: $*"; exit 1; }
[ -f "$here/dist/cli.js" ] || fail "build first: pnpm run build"
sf() { node "$here/dist/cli.js" "$@"; }
repo() { mkdir -p "$1" && cd "$1" && git init -q -b main && git config user.email t@example.com && git config user.name T && echo "# $1" > README.md && git add -A && git commit -q -m initial && sf init > /dev/null; }
edit() { node -e 'const fs = require("fs"); const [f, code] = process.argv.slice(1); const j = JSON.parse(fs.readFileSync(f)); new Function("j", code)(j); fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");' "$@"; }

echo "== 1. a plugin installs with softwarefactor add"
export FACTOR_HOME="$work/home-a"
repo "$work/a" || fail "no workspace"
sf add "$here/plugins/sample" --yes | tail -2 || fail "add"
sf plugins | grep -q "sample 1.0.0  sample/inbox@1" || fail "the plugin is not listed"
sf plugins | grep "sample 1.0.0"

echo "== 2. a GitHub-issue task is collected (the real gh, read only)"
edit .factor/workflows/starter.json 'j.collectors = [{ id: "issues", uses: "core/github-issues@1", with: { label: "bug", repo: "cli/cli" } }]'
out=$(sf collect) || fail "collect"
echo "$out" | sed -n 1p
echo "$out" | grep -Eq '^collected [1-9][0-9]* new tasks?$' || fail "no issue was collected"
node -e 'const { DatabaseSync } = require("node:sqlite"); const r = new DatabaseSync(".factor/state.db", { readOnly: true }).prepare("select key, title from tasks order by id limit 1").get(); console.log(r.key, "|", r.title.slice(0, 70));'

echo "== 3. an exported workflow imports and runs in a clean folder"
edit .factor/workflows/starter.json 'j.name = "shared"; j.collectors = [{ id: "tasks", uses: "core/file@1", with: { path: ".factor/tasks.md" } }]'
mv .factor/workflows/starter.json .factor/workflows/shared.json
edit .factor/factory.json 'j.workflow = "shared"'
sf account add claude-at-work --agent claude --profile "$work" > /dev/null || fail "account"
sf export --out "$work/shared.json" || fail "export"
export FACTOR_HOME="$work/home-b"
repo "$work/b" || fail "no clean folder"
hash=$(sf import "$work/shared.json" | grep -o -- '--hash [0-9a-f]*' | cut -d' ' -f2)
sf import "$work/shared.json" --yes --use --hash "$hash" | tail -2 || fail "import"
# what the person does on the new machine: say what "verify" is in this project (the role "author" is bound by init)
edit .factor/factory.json 'j.commands.verify = "true"'
git add -A && git commit -q -m "the shared workflow"
sf run | tail -3
id=$(node -e 'const { DatabaseSync } = require("node:sqlite"); console.log(new DatabaseSync(".factor/state.db", { readOnly: true }).prepare("select id from runs").get().id)')
sf approve "$id" | tail -2
node -e 'const { DatabaseSync } = require("node:sqlite"); const r = new DatabaseSync(".factor/state.db", { readOnly: true }).prepare("select workflow, status from runs").all(); console.log(JSON.stringify(r)); if (r.length !== 1 || r[0].status !== "done" || r[0].workflow !== "shared") process.exit(1);' || fail "the run in the clean folder did not end done"

echo "== 4. the export holds no secret and no account name"
shapes='(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|xox[bap]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY)'
echo "\$ grep -cE '$shapes' shared.json"
grep -cE "$shapes" "$work/shared.json"
echo "\$ grep -n -i -e password -e token -e secret shared.json   (every line that holds one of these words)"
grep -n -i -e password -e token -e secret "$work/shared.json"
echo "\$ grep -c -e claude-at-work -e \"\$HOME\" -e <the workspace> -e '\"account\"' -e '\"adapter\"' shared.json"
grep -c -e claude-at-work -e "$HOME" -e "$work" -e '"account"' -e '"adapter"' "$work/shared.json"
grep -qE "$shapes" "$work/shared.json" && fail "the export holds something shaped like a secret"
grep -q -e claude-at-work -e "$HOME" -e "$work" -e '"account"' -e '"adapter"' "$work/shared.json" && fail "the export holds an account or a path of this machine"
echo "phase 5 exit: ok"
