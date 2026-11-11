# `softwarefactor cost` leaves no database behind in a workspace that has no record

## Goal

In a workspace with no `.factor/state.db`, `softwarefactor cost` and `softwarefactor cost --check` print a line
that starts with "No sessions yet", exit 0, and do not create `.factor/state.db`. A workspace that has a record
behaves as before.

## Choices (the task left these open)

- **Cause:** `cost` reaches `openDb(ws.dbPath)` in `src/cli.ts`, which makes the file and runs the migrations. A
  read of the record should not write one.
- **Fix:** in the `runs`/`cost` branch of `src/cli.ts`, when the command is `cost` and `ws.dbPath` does not exist,
  open `":memory:"` instead. `openDb` migrates it, so `costReport`, `costCommand` and `costCheck` run unchanged on an
  empty record and print the same sentences they print today. No new code path in `cost.ts`, no change to the
  wording.
- **"Has a record" means the file exists.** A database with no session rows is a record: it is opened as before
  and prints the same sentence.
- **`--json`:** the same fix covers it (it shares the branch): `cost --json` with no database prints the empty
  report and creates no file. The task does not name it; leaving it to create the file would be the one `cost`
  form that still does.
- **`runs`:** the branch is shared, but `runs` is not named. It keeps opening (and creating) the database. Not in
  scope.
- **Other commands** (`sessions`, `inbox`, `status`, ...) are unchanged.
- **Outside a factory** (no `.factor/factory.json`) `cost` is still refused with "no factory yet"; the workspace
  is loaded first, as now.
- **Docs:** `docs/costs.md` gets one sentence: in a workspace with no record `cost` prints "No sessions yet" and
  creates no `.factor/state.db`.

## Acceptance criteria

1. Given an initialised workspace with no `.factor/state.db`, when `softwarefactor cost` runs (once or twice), then
   it exits 0, stderr is empty, stdout starts with "No sessions yet", and neither `state.db` nor its `-wal` or
   `-shm` file exists afterwards; the `.factor` folder lists as before and `git status` is clean.
2. Given the same workspace, when `softwarefactor cost --check` runs, then it exits 0, stdout starts with "No
   sessions yet", and no `state.db*` file exists afterwards.
3. Given the same workspace, when `softwarefactor cost --json` runs, then it exits 0, stdout is the report with
   `total.sessions` 0, and no `state.db*` file exists afterwards.
4. Given a workspace that has a record (a run was made), then `cost` prints the report (starts with "By task"),
   `cost --check` prints "Checked 1 session...", and `state.db` is still there. Given a `state.db` whose
   `sessions` table is empty, both still say "No sessions yet" and the file is kept.
5. Given a directory that is not a factory, `cost` still exits 1 with "no factory yet".
6. Given the docs, `docs/costs.md` says that with no record `cost` creates no `.factor/state.db`.
7. Given the existing cost tests (`costs`, `cost-check`, `cost-json*`, `cost-doc`, `sessions-command`), they still
   pass.

## Verification contract

- 1: test:test/acceptance/cost-no-record.test.ts
- 2: test:test/acceptance/cost-no-record.test.ts
- 3: test:test/acceptance/cost-no-record.test.ts
- 4: test:test/acceptance/cost-no-record.test.ts
- 5: test:test/acceptance/cost-no-record.test.ts
- 6: test:test/acceptance/cost-no-record.test.ts
- 7: test:test/acceptance/costs.test.ts, test:test/acceptance/cost-check.test.ts,
  test:test/acceptance/cost-json.test.ts, test:test/acceptance/cost-json-empty.test.ts,
  test:test/acceptance/cost-doc.test.ts

## Files to touch

- `src/cli.ts`: the `runs`/`cost` branch picks `":memory:"` for `cost` when `ws.dbPath` does not exist
  (`existsSync` is already imported there).
- `docs/costs.md`: the sentence.

## Approach

1. Tests first (done at planning, red): criteria 1–3 and 6 fail now because `state.db` is created and the doc
   lacks the sentence; 4 and 5 pass now and guard against breaking the rest.
2. The one-line change in `src/cli.ts`; 1–3 green.
3. The docs sentence; 6 green.
4. Run the cost tests.

## Done check

- `pnpm vitest run test/acceptance/cost` (every cost test, including the new file)
- `pnpm typecheck && pnpm lint`

## Risks / out-of-scope

- A factory running at the same moment creates the database between the `existsSync` and the read: `cost` then
  reports an empty record, which was true when it looked. No data is lost.
- `runs` and `sessions` still create the database; a separate task if wanted.
- The docs test takes the sentence in either of two wordings ("creates no `.factor/state.db`" or "does not create
  `.factor/state.db`"), and requires the words "no record".
