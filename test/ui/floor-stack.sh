#!/bin/bash
# The Floor at phone width, layers (round two, F3): with tasks queued, with a lane open as a sheet and a
# change pending, nothing paints over the text of another: not the queue strip over the bottom rail, not the
# sheet's fields over the strip. Measured as the text's centre: the element at that point is the text's own.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/floor-stack.sh [folder for screenshots]
# Prints "floor-stack: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="floor-stack-$$"
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
node -e '
const fs = require("fs");
const w = { $schema: "https://softwarefactor.io/schema/workflow/v1.json", version: 1, name: "queue", description: "One command.", roles: {}, limits: { minutes: 10, tokens: 1000 }, collectors: [{ id: "tasks", uses: "core/file@1", with: { path: ".factor/queue.md" } }],
  lanes: [{ id: "ship", name: "Ship", uses: "core/command@1", with: { run: "true" }, checkpoint: "in", on: { pass: "@done", fail: "@stop" } }] };
fs.writeFileSync(".factor/workflows/queue.json", JSON.stringify(w, null, 2));
fs.writeFileSync(".factor/queue.md", "- [ ] First chore\n- [ ] Second chore\n- [ ] Third chore\n");
const f = JSON.parse(fs.readFileSync(".factor/factory.json")); f.workflow = "queue"; fs.writeFileSync(".factor/factory.json", JSON.stringify(f, null, 2));'
git add -A && git commit -q -m "the queue workflow"
sf collect > /dev/null || fail "collect"

# every text that is on screen after it is scrolled to the start, the end and the middle of its view: the element
# at its centre is its own, or inside it, or holds it (a text under a sheet it has no business under is reported)
painted='() => {
  const out = [];
  const own = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  for (const e of document.querySelectorAll("body *")) {
    if (!own(e) || e.closest("[hidden], svg, .skip, .sr") || e.getClientRects().length === 0) continue;
    for (const at of ["start", "end", "center"]) {
      e.scrollIntoView({ block: at, inline: at });
      const r = e.getBoundingClientRect();
      const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
      if (r.width === 0 || x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue; // out of the window: not painted at all
      const top = document.elementFromPoint(x, y);
      if (top && !(top === e || e.contains(top) || top.contains(e))) { out.push("[" + e.textContent.trim().slice(0, 24) + "] under " + top.tagName.toLowerCase() + "." + top.className); break; }
    }
  }
  return out.length > 0 ? [...new Set(out)].join("; ") : "none";
}'

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 390 844
wait_for "the strip lists the queue" "() => document.querySelectorAll('.queue li').length" '^3$'
expect "plain state: no text is painted over by another's element" "$(js "$painted")" '^none$'
shot floor-stack-plain

# a lane open as a sheet, and a change pending
tab_to '^Lane Ship'
pw press Enter
wait_for "the lane's sheet is open" "() => document.querySelector('.inspector')?.dataset.open" '^true$'
tab_to '^Or a shell command'
pw type " x"
expect "a change is pending" "$(js "() => document.querySelector('.topbar .status').textContent")" '^Not saved$'
shot floor-stack-sheet
expect "sheet and pending change: no text is painted over by another's element" "$(js "$painted")" '^none$'
expect "the sheet ends above the rail" "$(js "() => document.querySelector('.inspector').getBoundingClientRect().bottom <= document.querySelector('.rail').getBoundingClientRect().top + 0.5")" '^true$'
expect "the strip does not reach the rail" "$(js "() => { const q = document.querySelector('.queue'); return q.getClientRects().length === 0 || q.getBoundingClientRect().bottom <= document.querySelector('.rail').getBoundingClientRect().top + 0.5; }")" '^true$'

playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "floor-stack: ok"
