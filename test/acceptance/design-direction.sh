#!/usr/bin/env bash
# The design direction is recorded: product context, DESIGN.md in its format, and the surface brief's contract.
set -u
cd "$(dirname "$0")/../.."
fail=0
bad() { echo "FAIL: $*"; fail=1; }
# body of one "## <heading>" section of a file
section() { awk -v h="$2" '$0 == "## " h {on=1; next} /^## /{on=0} on' "$1"; }

p=PRODUCT.md; d=DESIGN.md; b=.impeccable/surfaces/src-ui-index-html.md
for f in "$p" "$d" "$b"; do
  [ -f "$f" ] || { bad "$f missing"; continue; }
  [ "$(wc -c < "$f")" -le 20000 ] || bad "$f is over 20 KB"
  if grep -qE 'TODO|TBD|—' "$f"; then bad "$f has a TODO, TBD or em dash"; fi
done

if [ -f "$p" ]; then
  grep -q '<!-- impeccable:product-schema 1 -->' "$p" || bad "$p lacks the schema marker"
  [ "$(section "$p" Platform | grep -v '^$' | head -1)" = "web" ] || bad "$p: Platform is not web"
  for s in Users 'Product Purpose' Positioning 'Brand Commitments' 'Product Principles'; do
    [ "$(section "$p" "$s" | grep -c '[^[:space:]]')" -ge 2 ] || bad "$p: section '$s' is missing or thin"
  done
  grep -qi 'no interview' "$p" || bad "$p does not say it was made without an interview"
fi

if [ -f "$d" ]; then
  [ "$(head -1 "$d")" = "---" ] || bad "$d does not start with token frontmatter"
  front=$(awk 'NR==1{next} /^---$/{exit} {print}' "$d")
  echo "$front" | grep -q '^colors:' || bad "$d frontmatter has no colors"
  echo "$front" | grep -qE '^  night-[a-z-]+: ' || bad "$d frontmatter has no night theme colours"
  [ "$(echo "$front" | awk '/^typography:/{on=1;next} /^[a-z]/{on=0} on && /^  [a-z]+:$/' | wc -l)" -ge 4 ] \
    || bad "$d frontmatter has fewer than four type roles"
  want="Overview
Colors
Typography
Layout
Elevation & Depth
Shapes
Components
Do's and Don'ts"
  have=$(grep -E '^## ' "$d" | sed 's/^## //')
  [ "$have" = "$want" ] || bad "$d sections are not the format's eight, in order"
  section "$d" Overview | grep -q 'signature move' || bad "$d Overview names no signature move"
  section "$d" Overview | grep -qi 'before any screen' || bad "$d Overview does not say it was written before the build"
  # gradients and purple may only be named in order to forbid them
  if awk '/^### Don.t/{dont=1} /^## /{dont=0} !dont' "$d" | grep -qiE 'gradient|purple|violet'; then
    bad "$d mentions a gradient or purple outside its Don't list"
  fi
fi

if [ -f "$b" ]; then
  for k in THESIS OWN-WORLD STORY 'FIRST VIEWPORT' FORM FINISH; do
    grep -qE "^$k: .{20,}" "$b" || bad "$b lacks the $k block"
  done
  grep -qE 'seed:[0-9a-f]{16}' "$b" || bad "$b has no seed reference"
  [ "$(section "$b" 'Weighed and set aside' | grep -c 'Kept:')" -ge 3 ] || bad "$b does not record what was kept from at least three weighed directions"
fi

[ "$fail" -eq 0 ] && echo "design direction: ok"
exit "$fail"
