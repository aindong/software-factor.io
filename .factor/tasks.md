# The factory's own backlog

Tasks for Software Factor.io, worked by Software Factor.io. An open box is a task, and the indented lines
under it are its body.

- [ ] Print the version with `softwarefactor --version`
  `softwarefactor --version` and `softwarefactor version` print the version from package.json on one line
  and exit 0. They work outside a git repository and in the built command (`dist/cli.js`). The help lists
  the command. No new dependency.
- [x] `softwarefactor cost --json` prints the report as JSON
  `softwarefactor cost --json` prints exactly what the `costs` operation returns, as one JSON document on
  stdout and nothing else. With no sessions it prints the same shape with empty lists. `--json` together
  with `--check` is refused with a clear message and exit 1. `docs/costs.md` and the help say so.
- [x] `softwarefactor eval --list` lists the cases without running them
  It prints each case's id and the one line that says what the case shows, in the order they run. It runs no
  case and exits 0. Together with `--break`, `--save` or `--compare` it is refused with a clear message and
  exit 1. `docs/evals.md` and the help say so.
- [x] `softwarefactor cost` leaves no database behind in a workspace that has no record
  In a workspace with no `.factor/state.db`, `softwarefactor cost` and `softwarefactor cost --check` print a
  line that starts with "No sessions yet", exit 0, and do not create `.factor/state.db`. A workspace that has
  a record behaves as before.
- [ ] `softwarefactor eval --compare` refuses a result that was saved with a gate broken
  A file written by `softwarefactor eval --break <gate> --save <file>` is no result to compare with. Given such
  a file, `--compare` says which gate it was saved with, runs no case, and exits 1. A file saved without
  `--break` compares as before. `docs/evals.md` says so.
- [x] `softwarefactor requeue <run>` puts a stopped task back in the queue
  A run that stopped leaves its task stopped for good: the only way to try again is to write the task anew.
  `softwarefactor requeue <run>` sets the task of a stopped or dropped run back to queued, so the next
  `softwarefactor run` takes it in a new run on a new branch. The old run and its record stay as they are. It
  refuses a run that is still working or waiting, a run that ended done, and a task that is already queued,
  each with a clear message and exit 1. It is refused inside a run, like the other commands that change the
  factory. The help and `docs/operations.md` say so, and the operation is in the operations table.
- [x] `softwarefactor --version` prints the version (second try)
  `softwarefactor --version` and `softwarefactor version` print the version from package.json on one line
  and exit 0. They work outside a git repository and in the built command (`dist/cli.js`). The help lists
  the command. No new dependency. The first run of this task stopped on a fault of the factory, with its
  work unreviewed on the branch `factor/print-the-version-with-softwarefactor-ve-c5aef240`: read that
  branch before you plan, and take from it what is right.
