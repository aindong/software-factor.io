# Shared by the browser checks: drive the page with key presses, then read it. Nothing here
# clicks or focuses by script. Source it after setting $session and $work.

fail() {
  echo "FAIL: $1"
  playwright-cli -s="$session" close > /dev/null 2>&1
  [ -n "${server:-}" ] && kill "$server" 2> /dev/null
  [ -n "${cleanup:-}" ] && eval "$cleanup"
  exit 1
}
pw() { playwright-cli -s="$session" "$@" > "$work/pw.log" 2>&1; }
# the value a script returns in the page, as text: reading only
js() {
  playwright-cli -s="$session" eval "$1" 2> /dev/null | awk 'found { print; exit } /^### Result/ { found = 1 }' | sed -e 's/^"//' -e 's/"$//'
}
expect() { # expect <what> <got> <wanted pattern>
  echo "$2" | grep -Eq "$3" || fail "$1: got \"$2\", wanted /$3/"
}
wait_for() { # wait_for <what> <script> <wanted pattern>: for at most 8 seconds
  local got=""
  for _ in $(seq 1 40); do
    got=$(js "$2")
    echo "$got" | grep -Eq "$3" && return 0
    sleep 0.2
  done
  fail "$1: got \"$got\", wanted /$3/"
}
focused='() => { const a = document.activeElement; return (a?.getAttribute("aria-label") || a?.labels?.[0]?.textContent || a?.textContent || a?.tagName || "").replace(/\s+/g, " ").trim(); }'
tab_to() { # Tab until the keyboard is on what matches
  for _ in $(seq 1 80); do
    js "$focused" | grep -Eq "$1" && return 0
    pw press Tab
  done
  fail "Tab never reached /$1/, the keyboard is on \"$(js "$focused")\""
}
back_to() { # Shift+Tab until the keyboard is on what matches
  for _ in $(seq 1 80); do
    js "$focused" | grep -Eq "$1" && return 0
    pw press Shift+Tab
  done
  fail "Shift+Tab never reached /$1/, the keyboard is on \"$(js "$focused")\""
}
shot() {
  [ -n "${shots:-}" ] || return 0
  mkdir -p "$shots"
  pw screenshot --filename="$shots/$1.png" || fail "screenshot $1"
}
theme() { # the rail's own theme button, by keyboard: it is the last stop before the section
  back_to '^(Auto|Light|Dark)$'
  for _ in 1 2 3; do
    if [ "$(js "$focused")" = "$1" ]; then
      expect "the page is in the $1 theme" "$(js "() => { const l = Number(/oklch\\(([0-9.]+)/.exec(getComputedStyle(document.body).backgroundColor)?.[1] ?? -1); return l > 0.6 ? 'Light' : 'Dark'; }")" "^$1$"
      return 0
    fi
    pw press Enter
  done
  fail "the theme did not become $1"
}
section() { # a section of the rail, by keyboard
  tab_to "^$1"
  pw press Enter
}
narrow() { # at phone width the page must not scroll sideways
  expect "$1 does not scroll sideways at 390" "$(js "() => document.documentElement.scrollWidth <= 390")" '^true$'
}
fits() { # at phone width nothing in the section scrolls sideways, also not inside a box of its own
  narrow "$1"
  expect "nothing in $1 scrolls sideways at 390" "$(js "() => [...document.querySelectorAll('main *')].filter((e) => /auto|scroll/.test(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 1).map((e) => e.className).join(' ') || 'none'")" '^none$'
}
