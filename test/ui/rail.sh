#!/bin/bash
# The rail: every label has 4 px of clear space on each side of it, at desk and at phone width, in a text of 13 px
# at least; the theme button's name and tooltip say the mode and what a press does, while its word stays short.
# Needs playwright-cli and a built command (pnpm run build). The page is read, and the theme button pressed by key.
# Usage: bash test/ui/rail.sh [folder for screenshots]
# Prints "rail: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="rail-$$"
server=""
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
for name in $(env | sed -nE 's/^(FACTOR_[A-Za-z0-9_]*)=.*/\1/p'); do unset "$name"; done
export FACTOR_HOME="$work/home"
mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
node "$here/dist/cli.js" init > /dev/null || fail "init"

# the clear space each label has inside its own item, from the text itself (not the box of the grid cell)
room='() => {
  const out = [];
  for (const e of document.querySelectorAll(".rail a, .rail button")) {
    const node = [...e.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    if (!node) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const [t, box, c] = [range.getBoundingClientRect(), e.getBoundingClientRect(), getComputedStyle(e)];
    const left = t.left - (box.left + parseFloat(c.borderLeftWidth));
    const right = box.right - t.right;
    if (left < 3.99 || right < 3.99) out.push(node.textContent.trim() + " " + left.toFixed(1) + "/" + right.toFixed(1));
    if (parseFloat(c.fontSize) < 13) out.push(node.textContent.trim() + " is " + c.fontSize);
  }
  return out.length ? out.join("; ") : "room";
}'
start_ui 0
pw open "$address" || fail "the browser did not open"
for width in 1440 390; do
  pw resize "$width" 900
  pw reload
  wait_for "the rail is drawn at $width" "() => document.querySelectorAll('.rail a').length" '^[1-9]'
  expect "every label of the rail has 4 px clear on each side at $width, in 13 px at least" "$(js "$room")" '^room$'
done
expect "the theme button's name says the mode and what a press does" "$(js "() => { const b = document.querySelector('.rail button'); return b.getAttribute('aria-label') + ' | ' + b.title + ' | ' + b.textContent.trim(); }")" '^Theme: auto\. Press for light\. \| Theme: auto\. Press for light\. \| Auto$'
theme Light
expect "after a press the name follows the mode" "$(js "() => document.querySelector('.rail button').getAttribute('aria-label')")" '^Theme: light\. Press for dark\.$'

playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "rail: ok"
