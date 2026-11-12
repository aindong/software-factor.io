# Accounts: each login's limits first (issue #12)

## Goal

The Accounts page and `softwarefactor account list` show, for each login, the limit windows its CLI
reports (name, percent used as text, a meter, when it resets), how old that reading is, and the
factory's own count beside it under its own name. A login on hold or near the end of a window is
marked in words. Logins and their limits are the page's first subject. Roles come second.

## Choices made without asking

The task says not to ask, so these are decided here. Each one can be changed at review.

- **Claude Code** is read with `claude -p /usage`: exactly those two arguments, stdin closed, cwd the
  system temp folder, the profile given the way the adapters give it (`profileEnv`), and the `bin` of the
  account. The issue says this prints the usage page with no model call. That is not checked against the
  real CLI here (see Risks). Timeout 20 s, then SIGKILL.
- **The lines read**: `<name>: <n>% used · resets <text>`, where the name begins `Current session` or
  `Current week (`. ANSI colour codes are stripped first. The reset is kept as the CLI's own words, not
  parsed into a date. Any other line is passed over.
- **The windows expected for Claude Code** are `Current session`, `Current week (all models)` and at least one
  `Current week (<model>)`. One that is not printed is listed with `percent: null, resets: null` and shown as
  "not reported", never as 0. When no named-model week is printed, the placeholder is
  `Current week (one model)`. Every named-model week that is printed is shown.
- **Codex**: nothing is started. A Codex CLI offers no limits without a model call (no headless `/status`), so the
  reading is `none: "Codex does not report its limits without a model call, so none are shown."`. Kimi and
  command accounts get a sentence of the same kind. No file in any profile folder is read, by any agent.
- **Kept**: readings go in `limits.json` under the factor home, `{ "<account>": Reading }`. It is written
  beside the old file and moved into place, as `accounts.json` is. A removed account's reading is dropped
  from the view because the view lists accounts from `accounts.json`.
- **When a reading is taken**: by `accounts_list` with `{ "read": true }`, and by `softwarefactor account
  list`, which a person runs to look. `accounts_list` with `{}` (the MCP default, and the page after a
  bind) returns what is kept and starts no CLI. The page asks for `{}` first so it shows at once. Then
  it asks for `{ read: true }` once when it opens, and again when the "Read the limits again" button is
  pressed. Nothing reads on a timer.
- **Near a limit** means 90% or more of any window: a CLI window's percent ≥ 90, or the factory's
  `used ≥ 0.9 × tokens`. **On hold** is the factory's existing `heldUntil`.
- **Wording**, which the tests hold. Section headings are "Logins" and then "Who works each role". The
  button is "Read the limits again". The age is "Read just now" or "Read 5 min ago" (`ago()` in
  `src/ui/words.ts`). A failure is "The limits could not be read: <reason>". The marks are "On hold until
  <time>" and "Near a limit". The factory's part is "The factory's own count", saying it counts only the
  factory's runs, as "400 of 1,000 tokens in 5 h".
- **The critique report is committed** at `docs/critiques/accounts-limits.md` and attached to the run's
  evidence too. The run's evidence folder is not in the repository, and the gates check a clean
  checkout. The screenshots go in the run's evidence only, so the public repository holds no images.
- **The browser check clears the outer run's `FACTOR_*` variables**, as `test/helpers/clean-env.ts`
  already does for the suite. Inside a lane, `softwarefactor init` refuses to run otherwise. The check
  works only in a throwaway workspace with its own `FACTOR_HOME`.

## Acceptance criteria

1. Given the text `Current week (all models): 73% used · resets Nov 15 at 6:59am (Asia/Manila)` and the
   session and Fable lines like it, when `parseUsage` reads it, then each line gives `{ name, percent,
   resets }` with exactly the name, number and reset words printed.
2. Given usage text with lines it does not know ("Extra usage: off", "Current month (credits): $4.00
   spent", a banner), when it is read, then those lines give no window. Given text with no window, or
   without the session line, then every expected window that is missing has `percent: null` and
   `resets: null`, which the page and the command line show as "not reported". Never 0.
3. Given a Claude Code login whose CLI exits 1 with "Not logged in · Please run /login", or whose binary is not there, when its
   limits are read, then the reading has no windows and `failed` holds the reason (the CLI's words and
   its exit code, or "could not be started"). Given a Codex login, then no process is started and
   `none` says in plain words that Codex reports nothing without a model call. A Claude Code CLI is
   started with exactly `-p /usage`.
4. Given logins with stand-in CLIs, when `accounts_list` is called with `{ read: true }`, then each
   Claude Code login has `reading: { at, windows, failed, none }` with `at` the time of the reading.
   A later `accounts_list` with `{}` returns the same `at` and starts no CLI. A failed login says why
   while the others keep their windows. The factory's `limits` (`hours`, `tokens`, `used`) are as before.
   Nothing of a login's files or folder path is in the answer.
5. Given the same logins, when `softwarefactor account list` runs, then it exits 0 and prints, under each
   login's line as it is now, its windows as the CLI words them (`Current week (Fable): 92% used ·
   resets Nov 15 at 7am (Asia/Manila)`), `Current session: not reported` for a window not printed, `read
   at <ISO time>`, a failure's reason, the Codex sentence, and "the factory's own count: 400 of 1,000
   tokens in 5 h". It keeps that reading, and the page reads it next.
6. Given the built page with those logins, when a person moves through it by keyboard only, then each
   reported window has a meter whose percent is written beside it as "N% used". A window not printed has
   no meter and says "not reported". The reading's age is shown. The factory's own count is named
   apart. "Near a limit" and "On hold" are written on the logins they apply to. A failed reading
   says why and Codex says it reports nothing. "Logins" is the first heading of the page and "Who works
   each role" the next. Tab reaches every control. All of this holds in light and dark at 1440 and at
   390 wide, with nothing cut off and nothing scrolling sideways at 390.
7. Given the page open, when nothing is pressed, then each Claude Code CLI was started once and is not
   started again: there is no reading in the background. When "Read the limits again" is pressed with
   Enter, a new reading is taken and shown.
8. Given screenshots of the built page (the four `accounts-limits-<theme>-<width>.png` from the browser
   check), when the `impeccable` skill's `critique` command is run on them, then its report is committed at
   `docs/critiques/accounts-limits.md` and attached to the run's evidence. The report gives its severities
   with the highest first, `major:` as the two highest, a `counts:` line that matches its list, `where:`,
   `what:` and `fix:` for each finding, and no finding of the two highest severities. It is made on a commit
   that holds the last change to `src/ui`.

## Verification contract

- 1: test:test/unit/usage-reading.test.ts
- 2: test:test/unit/usage-reading.test.ts
- 3: test:test/unit/usage-reading.test.ts
- 4: test:test/acceptance/accounts-limits.test.ts
- 5: test:test/acceptance/accounts-limits.test.ts
- 6: cmd:pnpm run build && bash test/ui/accounts-limits.sh "$EVIDENCE/screens"
- 7: cmd:pnpm run build && bash test/ui/accounts-limits.sh "$EVIDENCE/screens"
- 8: test:test/acceptance/accounts-critique.sh

`test/ui/accounts-limits.sh` is new and red now: "no login work". It needs playwright-cli, so `pnpm test` does not run it.
`test/acceptance/accounts-critique.sh` runs inside `pnpm test` through `shell-checks.test.ts`, and is red
now because the report is missing.

## Files to touch

- `src/core/limits.ts` (new): `parseUsage(text)`, `readAccountLimits(account): Promise<Reading>` (one login,
  nothing kept), `readLimits(): Promise<Record<string, Reading>>` (every account, in parallel, kept),
  `keptLimits()`. `Window = { name, percent: number | null, resets: string | null }`, `Reading = { at, windows,
  failed: string | null, none: string | null }`. Use async `execFile`, not `spawnSync`, so the interface's
  server is not blocked while a CLI answers. The reason for a failure never holds the bin path or the profile.
- `src/core/views.ts`: `AccountsView.accounts[]` gains `reading: Reading | null` from `keptLimits()`.
- `src/core/operations.ts`: `accounts_list` takes `z.strictObject({ read: z.boolean().optional() })`. Its
  `run` becomes async: `if (input.read) await readLimits()`, then `accountsView`. The description says that
  `read` starts each login's CLI for its usage page, with no model call.
- `src/core/commands.ts`: `account list` awaits `readLimits()` and prints the lines of criterion 5 under each
  login's present line, which stays as it is so the tests that grep it still pass. `accountCommand`
  becomes async, and `src/cli.ts` already awaits inside `main`.
- `test/fixtures/bin/standin-core.mjs`: for `claude -p /usage`, print `plan.usage.out` (default nothing) and exit
  `plan.usage.exit ?? 0` before anything is written to `calls.jsonl`, as `mcp list` does. Then the tests that
  count a stand-in's calls do not see the reading `account list` now takes.
- `test/ui/accounts.sh`: give its two accounts `--bin` stand-ins (the fixture's `claude` and `codex`), so no
  browser check starts a real CLI when the page opens.
- `src/ui/Logins.tsx` (new): one `<article>` for each login with an `h3` that begins with its name, then its
  agent, its marks, its windows (a list, with a `role="meter"` element with `aria-valuenow`, and "N% used ·
  resets …" in the same parent), the age and any failure, then "The factory's own count". `Accounts.tsx` keeps the
  roles and the top bar with the button, and uses `Logins`. `Accounts.tsx` is 11.5 KB now. No file goes
  over 20 KB.
- `src/ui/sections.css` or a new `src/ui/accounts.css`: the login blocks and the meter. The meter is a rule
  track with an ink fill, uses palette tokens only, and is not a grid of cards. The near and hold marks are
  words after the diamond the palette already has. Add a pair to `test/unit/contrast.test.ts` if a shape
  lands on a new ground.
- `test/ui/all.sh`: run `accounts-limits` and add it to the list of scripts checked for clicks.
- `DESIGN.md` (the "Accounts, Costs and Plugins" part) and `docs/accounts.md` (a "What the CLI reports" part
  under Limits): what is shown and where it comes from. Say that `claude -p /usage` was not tried against the
  real CLI by the tests, and that the factory's count covers only its own runs.
- `docs/critiques/accounts-limits.md` (new, made last): the critique report.

## Approach

1. Commit this plan and the red tests (done by the planning lane).
2. `limits.ts` until `test/unit/usage-reading.test.ts` is green.
3. The view, the operation and the command until `test/acceptance/accounts-limits.test.ts` is green. Then
   the stand-in fixture branch, and run the full suite: the tests that grep `account list` or count
   `calls.jsonl` must stay green.
4. The page: `Logins.tsx`, the CSS, then `pnpm run build && bash test/ui/accounts-limits.sh <shots>` until
   green, and `bash test/ui/accounts.sh` still green.
5. Run `impeccable` `critique` on the four screenshots. Fix every finding of the two highest severities,
   take the screenshots again, and run the critique again until none is left. Commit the last report with
   `commit:` naming the commit it looked at. Attach it and the screenshots to the run's evidence.
6. Docs, then the done check.

## Done check

```sh
pnpm run typecheck && pnpm run lint && pnpm run build && pnpm test
bash test/ui/accounts-limits.sh "$EVIDENCE/screens"
bash test/ui/accounts.sh
bash test/acceptance/accounts-critique.sh
```

## Risks / out-of-scope

- **`claude -p /usage` is taken from the issue, not tried here.** If the real CLI makes a model call for it,
  or prints other words, the tests stay green and the real page is wrong. The first run on a real login
  must be looked at by a person. `docs/accounts.md` says it is not verified.
- On a machine with a real `claude` on the PATH, an account added without `--bin` is read with it when the page opens.
  The reading uses the account's own profile, as a lane would.
- `account list` now starts each Claude Code CLI, so it is as slow as the slowest one, up to 20 s.
- Two readings at once: the last one written wins. Nothing is lost that matters.
- No skeptic subagent was available in this lane, so the plan was checked by `alleo-plan-check` only.
- Not done, as the issue asks: no history or chart of usage, no reading in the background, no change to how
  a limit parks a run, no new setting. Codex's limits from its session files are not read either. Those
  files are not the CLI's own report, and they come from model calls.
