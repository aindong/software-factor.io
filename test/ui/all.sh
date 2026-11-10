#!/bin/bash
# Every browser check of the interface, and a screenshot of every main screen in both themes at
# desktop and phone width. Needs playwright-cli and a built command (pnpm run build). It takes
# about twelve minutes: each check walks the page by keyboard.
# Usage: bash test/ui/all.sh <folder for screenshots>
# Prints "all: ok" and exits 0, or says what failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:?give a folder for the screenshots}

# the checks drive the page with keys (and, where a pointer's bug is guarded, a real mouse press):
# none of them clicks, focuses, dispatches an event or sets an attribute by script
scripted=$(grep -nE '\.click\(|\.focus\(|dispatchEvent|setAttribute' "$here"/test/ui/floor.sh "$here"/test/ui/runs.sh "$here"/test/ui/inbox.sh "$here"/test/ui/keys.sh)
[ -z "$scripted" ] || { echo "FAIL: a check acts on the page by script: $scripted"; exit 1; }

mkdir -p "$shots"
rm -f "$shots"/*.png # what is in the folder afterwards was taken by this run
for check in floor runs inbox; do
  bash "$here/test/ui/$check.sh" "$shots" || { echo "FAIL: $check.sh"; exit 1; }
done
for screen in floor runs run inbox accounts costs plugins; do
  for theme in light dark; do
    for width in 1440 390; do
      file="$shots/$screen-$theme-$width.png"
      [ -s "$file" ] || { echo "FAIL: no screenshot $screen-$theme-$width.png"; exit 1; }
      # the picture itself is that wide (once or twice, by the screen's pixel ratio)
      wide=$(node -e 'const b = require("fs").readFileSync(process.argv[1]); console.log(b.readUInt32BE(16));' "$file")
      [ "$wide" = "$width" ] || [ "$wide" = "$((width * 2))" ] || { echo "FAIL: $screen-$theme-$width.png is $wide pixels wide"; exit 1; }
    done
  done
done
echo "all: ok"
