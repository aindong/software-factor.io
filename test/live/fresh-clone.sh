#!/bin/bash
# A stranger's first ten minutes: a fresh clone, then exactly the commands of the README's quick
# start, read out of the clone's README and run in order. Two things are put in their place, and
# nothing else: the address of the clone (this repository's commits, not GitHub, so the check
# tests what is here) and "<run>" (the id that `softwarefactor inbox` printed, as the README says).
# It ends ok when the factory ran one task to done on the scripted agent, after two approvals (the
# plan, then the ship), with the hello file on the branch the project started on, in under ten minutes.
# Usage: bash test/live/fresh-clone.sh      (needs node 24, git and pnpm; a cold pnpm store needs the network)
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
limit=600
started=$SECONDS

# a machine of its own: no factor home, and an identity for git's commits
export FACTOR_HOME="$work/factor-home"
export GIT_AUTHOR_NAME=Stranger GIT_AUTHOR_EMAIL=stranger@example.com GIT_COMMITTER_NAME=Stranger GIT_COMMITTER_EMAIL=stranger@example.com
# a folder with a space in its name, as many people's are
mkdir -p "$work/my code" && cd "$work/my code" || fail "no work folder"
git clone -q --no-hardlinks "$here" software-factor.io || fail "clone"
echo "\$ git clone <this repository> software-factor.io   (commit $(git -C software-factor.io rev-parse --short HEAD))"

# the quick start, as the clone's own README has it
readme="$work/my code/software-factor.io/README.md"
[ -s "$readme" ] || fail "the clone has no README.md"
block=$(awk '/<!-- quick-start:begin -->/ { on = 1; next } /<!-- quick-start:end -->/ { on = 0 } on && !/^```/' "$readme")
[ -n "$block" ] || fail "the README has no quick start between its markers"
for needed in "git clone " "pnpm install" "pnpm run build" "softwarefactor init" "softwarefactor run" "softwarefactor approve <run>"; do
  echo "$block" | grep -qF "$needed" || fail "the quick start does not hold: $needed"
done

shopt -s expand_aliases
steps=0
approvals=0
while IFS= read -r line; do
  case "$line" in "" | "#"*) continue ;; esac
  case "$line" in
    "git clone "*) continue ;; # done above, from this repository
    *"<run>"*)
      run=$(softwarefactor inbox | head -1 | cut -d' ' -f1)
      [ -n "$run" ] || fail "the inbox names no run to approve"
      line=${line//<run>/$run}
      ;;
  esac
  at=$SECONDS
  echo "\$ $line"
  eval "$line" > "$work/step.log" 2>&1
  status=$?
  sed 's/^/    /' "$work/step.log" | tail -8
  echo "    (exit $status, $((SECONDS - at))s)"
  # a run that waits for its approval exits 3, as the README says: every other command must exit 0
  # the first approval is of the plan and the run waits again before the ship (3); the second ends it (0)
  case "$line" in
    "softwarefactor run") [ "$status" -eq 3 ] || fail "softwarefactor run exited $status, and the README says it waits (3)" ;;
    "softwarefactor approve "*)
      approvals=$((approvals + 1))
      case "$approvals" in
        1) [ "$status" -eq 3 ] || fail "the approval of the plan exited $status, and the README says the run waits before the ship (3)" ;;
        *) [ "$status" -eq 0 ] || fail "approval $approvals exited $status, and the README says the run is done (0)" ;;
      esac
      ;;
    *) [ "$status" -eq 0 ] || fail "exit $status: $line" ;;
  esac
  steps=$((steps + 1))
done <<EOF
$block
EOF
[ "$approvals" -eq 2 ] || fail "the quick start approves $approvals times, and the starter needs two"
[ "$steps" -ge 10 ] || fail "only $steps commands were run"

# what a stranger has now: a factory in hello-factory whose one task ran to the end through five lanes
[ "$(pwd)" = "$work/my code/hello-factory" ] || fail "the quick start did not end in the project it made: $(pwd)"
[ -z "$(git status --porcelain)" ] || fail "the project is left with changes that are not committed: $(git status --porcelain | head -3)"
node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(".factor/state.db", { readOnly: true });
const runs = db.prepare("select status from runs").all();
const agents = db.prepare("select distinct agent from sessions").all().map((s) => s.agent);
const approved = db.prepare("select count(*) as n from inbox where status <> ?").get("open").n;
const lanes = db.prepare("select lane, outcome from lane_runs order by id").all().map((l) => l.lane + ":" + l.outcome);
console.log("runs:", JSON.stringify(runs), "agents:", JSON.stringify(agents), "approvals:", approved, "lanes:", lanes.join(" "));
if (runs.length !== 1 || runs[0].status !== "done") process.exit(1);
if (agents.length !== 1 || agents[0] !== "fake") process.exit(2); // no login of any agent was used
if (approved !== 2) process.exit(3);
if (lanes.join(" ") !== "plan:pass build:pass review:pass test:pass ship:pass") process.exit(4);
' || fail "the record does not show one run, done, after two approvals, through all five lanes, on the scripted agent"
# the work is where the README says it is: merged into the branch the project started on
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || fail "the project is not on main"
git ls-files --error-unmatch FACTOR-HELLO.md > /dev/null 2>&1 || fail "FACTOR-HELLO.md is not on main"
git log --oneline main | grep -q "Say hello from the factory" || fail "main does not hold the scripted agent's commit"

took=$((SECONDS - started))
echo "from clone to a finished run: ${took}s (the limit is ${limit}s)"
[ "$took" -lt "$limit" ] || fail "it took ${took}s"
echo "fresh clone: ok"
