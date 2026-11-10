#!/bin/bash
# Every browser check of the interface, and a screenshot of every main screen in both themes at
# desktop and phone width. Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/all.sh <folder for screenshots>
# Prints "all: ok" and exits 0, or says what failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:?give a folder for the screenshots}
mkdir -p "$shots"
for check in floor runs inbox; do
  bash "$here/test/ui/$check.sh" "$shots" || { echo "FAIL: $check.sh"; exit 1; }
done
missing=""
for screen in floor runs run inbox accounts costs plugins; do
  for theme in light dark; do
    for width in 1440 390; do
      [ -s "$shots/$screen-$theme-$width.png" ] || missing="$missing $screen-$theme-$width.png"
    done
  done
done
[ -z "$missing" ] || { echo "FAIL: no screenshot of:$missing"; exit 1; }
echo "all: ok"
