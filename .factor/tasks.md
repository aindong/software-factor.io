# The factory's own backlog

Tasks for Software Factor.io, worked by Software Factor.io. An open box is a task, and the indented lines
under it are its body.

- [ ] Print the version with `softwarefactor --version`
  `softwarefactor --version` and `softwarefactor version` print the version from package.json on one line
  and exit 0. They work outside a git repository and in the built command (`dist/cli.js`). The help lists
  the command. No new dependency.
- [ ] `softwarefactor cost --json` prints the report as JSON
  `softwarefactor cost --json` prints exactly what the `costs` operation returns, as one JSON document on
  stdout and nothing else. With no sessions it prints the same shape with empty lists. `--json` together
  with `--check` is refused with a clear message and exit 1. `docs/costs.md` and the help say so.
- [ ] `softwarefactor eval --list` lists the cases without running them
  It prints each case's id and the one line that says what the case shows, in the order they run. It runs no
  case and exits 0. Together with `--break`, `--save` or `--compare` it is refused with a clear message and
  exit 1. `docs/evals.md` and the help say so.
- [ ] `softwarefactor cost` leaves no database behind in a workspace that has no record
  In a workspace with no `.factor/state.db`, `softwarefactor cost` and `softwarefactor cost --check` print a
  line that starts with "No sessions yet", exit 0, and do not create `.factor/state.db`. A workspace that has
  a record behaves as before.
- [ ] `softwarefactor eval --compare` refuses a result that was saved with a gate broken
  A file written by `softwarefactor eval --break <gate> --save <file>` is no result to compare with. Given such
  a file, `--compare` says which gate it was saved with, runs no case, and exits 1. A file saved without
  `--break` compares as before. `docs/evals.md` says so.
