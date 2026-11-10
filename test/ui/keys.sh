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
focused='() => { const a = document.activeElement; if (!a || a === document.body) return "(nothing)"; return (a?.getAttribute("aria-label") || a?.labels?.[0]?.textContent || a?.textContent || a?.tagName || "").replace(/\s+/g, " ").trim(); }'
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
shot() { # a screenshot named <screen>-<theme>-<width> is checked to be of that section, in that theme, at that width
  local named section
  named=$(echo "$1" | sed -nE 's/^(floor|runs|run|inbox|accounts|costs|plugins)-(light|dark)-(1440|390)$/\1 \2 \3/p')
  if [ -n "$named" ]; then
    case "${named%% *}" in run) section=Runs ;; *) section=$(echo "${named%% *}" | awk '{ print toupper(substr($0, 1, 1)) substr($0, 2) }') ;; esac
    expect "the page is as the screenshot $1 is named" "$(js "() => { const l = /oklch\\(([0-9.]+)/.exec(getComputedStyle(document.body).backgroundColor)?.[1]; if (l === undefined) return 'no ground colour read'; return document.querySelector('.rail [aria-current=page]').childNodes[1].textContent + ' ' + (Number(l) > 0.6 ? 'light' : 'dark') + ' ' + innerWidth; }")" "^$section ${named#* }$"
  fi
  [ -n "${shots:-}" ] || return 0
  mkdir -p "$shots"
  pw screenshot --filename="$shots/$1.png" || fail "screenshot $1"
}
theme() { # the rail's own theme button, by keyboard: it is the last stop before the section
  back_to '^(Auto|Light|Dark)$'
  for _ in 1 2 3; do
    if [ "$(js "$focused")" = "$1" ]; then
      expect "the page is in the $1 theme" "$(js "() => { const l = /oklch\\(([0-9.]+)/.exec(getComputedStyle(document.body).backgroundColor)?.[1]; return l === undefined ? 'no ground colour read' : Number(l) > 0.6 ? 'Light' : 'Dark'; }")" "^$1$"
      return 0
    fi
    pw press Enter
  done
  fail "the theme did not become $1"
}
section() { # a section of the rail, by keyboard (the inbox's name may carry its count)
  tab_to "^$1([0-9].*)?$"
  pw press Enter
}
narrow() { # at phone width the page must not scroll sideways
  expect "$1 does not scroll sideways at 390" "$(js "() => document.documentElement.scrollWidth <= 390")" '^true$'
}
fits() { # at phone width nothing scrolls sideways but the map, a block of output and a diff
  narrow "$1"
  expect "nothing in $1 scrolls sideways at 390" "$(js "() => [...document.querySelectorAll('body *')].filter((e) => /auto|scroll/.test(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 1 && !e.closest('.map-scroll, .output')).map((e) => e.className || e.tagName).join(' ') || 'none'")" '^none$'
}
# the controls a person can reach with Tab: shown, enabled, and a stop of the Tab order
tabbable='[...document.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")].filter((e) => !e.disabled && e.tabIndex >= 0 && e.getClientRects().length > 0)'
walk() { # walk <what>: a walk with the Tab key visits every control that is shown and enabled
  local n at seen="" visited missed
  n=$(js "() => ${tabbable}.length")
  for _ in $(seq 1 $((n + 3))); do
    pw press Tab
    at=$(js "() => ${tabbable}.indexOf(document.activeElement)")
    seen="$seen $at"
  done
  visited=$(echo "$seen" | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -un | wc -l | tr -d ' ')
  if [ "$visited" != "$n" ]; then
    missed=$(js "() => { const seen = new Set('$seen'.trim().split(' ').map(Number)); return ${tabbable}.filter((e, i) => !seen.has(i)).map((e) => e.getAttribute('aria-label') || e.textContent.trim().slice(0, 30) || e.tagName).join(' | '); }")
    fail "$1: Tab visited $visited of $n controls, and not: $missed"
  fi
}
arrow_to() { # the arrow keys, along the map or a list, until the keyboard is on what matches
  local key
  for key in ArrowRight ArrowRight ArrowRight ArrowRight ArrowRight ArrowRight ArrowRight ArrowRight ArrowRight ArrowRight ArrowLeft ArrowLeft ArrowLeft ArrowLeft ArrowLeft ArrowLeft ArrowLeft ArrowLeft ArrowLeft ArrowLeft ArrowLeft ArrowLeft ArrowLeft ArrowLeft ArrowLeft ArrowLeft ArrowLeft ArrowLeft ArrowLeft ArrowLeft; do
    js "$focused" | grep -Eq "$1" && return 0
    pw press "$key"
  done
  js "$focused" | grep -Eq "$1" || fail "the arrow keys never reached /$1/, the keyboard is on \"$(js "$focused")\""
}
# the keys that move the caret in a text field, which differ by system
if [ "$(uname)" = "Darwin" ]; then
  text_top="Meta+ArrowUp" text_bottom="Meta+ArrowDown" line_end="Meta+ArrowRight"
else
  text_top="Control+Home" text_bottom="Control+End" line_end="End"
fi
start_ui() { # start_ui <port>: the interface as a process of its own, so that stopping it stops it
  node "$here/dist/cli.js" ui --port "$1" > "$work/ui.log" 2>&1 &
  server=$!
  for _ in $(seq 1 50); do grep -q "#t=" "$work/ui.log" && break; sleep 0.1; done
  address=$(grep -o 'http://127.0.0.1:[0-9]*/#t=[0-9a-f]*' "$work/ui.log") || fail "the interface did not start: $(cat "$work/ui.log")"
}
