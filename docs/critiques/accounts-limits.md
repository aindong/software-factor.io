# Design critique: the Accounts page, each login's limits (issue #12)

⚠️ DEGRADED: single-context (this factory lane exposes no sub-agent tool, and the lane's guard refused to run the
impeccable launcher from the skill's folder, so `impeccable context`, `impeccable detect` and the live overlay did
not run; the skill's write hook did run its detector on `src/ui/Logins.tsx` and `src/ui/accounts.css` and found
nothing)

skill: impeccable critique
severities: P0 P1 P2 P3
major: P0 P1
screens: accounts-limits-light-1440.png accounts-limits-dark-1440.png accounts-limits-light-390.png accounts-limits-dark-390.png
counts: P0=0 P1=0 P2=0 P3=5
commit: cf9587f5439335e570865ef7f0b63de5cd0cbf7a

The screenshots were taken by `test/ui/accounts-limits.sh` from the build of the commit above, with stand-in CLIs:
`work` (two weeks reported, the session not, 92% of the Fable week, a factory limit of 1,000 tokens in 5 h with 400
used), `spare` (on hold, 40% and 41%), `broken` (its CLI says "Not logged in") and `other` (Codex). They are kept
in the run's evidence, not in the repository. The page is an Operate surface: the person glances at it before
starting more runs.

## Design health

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of system status | 3 | The age is written on every login; while the CLIs are read, the button is off and a line says so. |
| 2 | Match with the real world | 4 | The windows carry the CLI's own names and reset words, so they match `claude /usage`. |
| 3 | User control and freedom | 3 | Nothing here changes a login; a reading can be taken again at any time. |
| 4 | Consistency and standards | 3 | Diamond and words as everywhere else; the h2 and the h3 share one size (F4). |
| 5 | Error prevention | n/a | The limits part of the page takes no input. |
| 6 | Recognition rather than recall | 3 | The CLI's windows and the factory's count are each under their own label; `--limit` is named where none is set. |
| 7 | Flexibility and efficiency | 3 | Every control is reached with Tab; no key of its own for "Read the limits again" (F5). |
| 8 | Aesthetic and minimalist design | 3 | Dense and flat as the system asks; "Read just now" repeats on each login (F1). |
| 9 | Error recovery | 3 | A failed reading gives the CLI's words and exit code, beside the other logins, which still show. |
| 10 | Help and documentation | 3 | One line under "Logins" says what the two counts are; the command to add a login is under the list. |
| **Total** | | **28/36** | **Good (78%)** |

## Design specificity

The page reads as this product's: rules between blocks rather than cards, the vermilion diamond with words for a
problem (as on the floor and in the inbox), a flat ink meter on the hairline colour, Barlow Semi Condensed for the
numbers. Nothing on it could be lifted unchanged into a generic dashboard: the meters stay thin, carry no colour
scale and always sit beside their percent in words. A window that was not printed has no meter at all, so an empty
bar is never read as zero.

Deterministic scan: not run here (see the banner). The write hook's detector reported no issue in `Logins.tsx`
and `accounts.css`.

## What works

- At a glance: the two marks that matter, "Near a limit" and "On hold until … : no lane starts on it before then",
  sit on the login's heading line, after a diamond, in words. They are the first thing after the name.
- The CLI's windows and the factory's own count never touch: separate columns at 1440, separate labelled parts at
  390, and only the CLI's windows have meters.
- The failure states are as calm as the success states: a login that could not be read and a Codex login both
  keep their block, say why in one sentence, and leave the rest of the page as it was.

## Earlier pass on this page

The first look, on commit a47d276, found one P2: "On hold until 12:31 PM" said nothing of what the hold means,
beside windows at 40%. Fixed in the commit above by saying that no lane starts on it before then. It is not in the
list below because it is closed.

## Findings

### F1 [P3] The age of the reading repeats on every login
where: each login block, the line "Read just now" under its windows
what: All logins are read at once, so four blocks say the same age; it adds a line per login without news.
fix: Keep it per login (a single login's CLI can answer late), but drop it to the heading line of the block or say it once beside the button when every reading has the same time.

### F2 [P3] The factory's own count sits far from the windows at 1440
where: the right column of each login at 1440 wide
what: The count starts about 120px after the longest window line, so the eye travels across empty ground to find it.
fix: Let the first column end where its content ends, and keep the columns aligned across logins.

### F3 [P3] A failed reading names a step to take but not where
where: the block of `broken`, "Please run /login"
what: The CLI's words tell the person to log in, but not that it must be done in that login's profile, in a terminal.
fix: After the CLI's words, add one sentence that says the login is made again in a terminal with that login's CLI.

### F4 [P3] The section heading and the login names are one size
where: "Logins" (h2) and "work", "spare" (h3)
what: Both are 1.0625rem at weight 600, so the section reads no higher than a login.
fix: Keep h3 at the section size and give the h2 a rule or the label style above it, or set the h3 at body size 600.

### F5 [P3] No key for a new reading
where: the "Read the limits again" button
what: A keyboard user Tabs to it every time; the floor and the inbox give their main actions a key.
fix: Give it a key named in its key cap, as the inbox does for its decisions.

## Persona red flags

- Alex (power user): reaches the button with two Tabs from the rail; no key of its own (F5). Nothing else in the way.
- Sam (keyboard and screen reader): each meter is a native `meter` with its window and login as its name and "N% used"
  as its value text; the diamonds are hidden from the reader and the words beside them carry the meaning. No red flag.
- The owner, glancing between runs: the marks on the heading line answer "can I start more runs on this login?" in
  under two seconds. No red flag.

## Questions for the owner

- Should a hold also say where it came from (the CLI said the limit was reached, or the factory's own count reached
  its headroom)? Options: say the source; keep the time and the consequence only, as now.
- Should the age be said once for the page when every login was read together (F1)? Options: once by the button;
  on each login, as now.

---

# Part two: a reviewer who did not build the page

Made after the build, by a reviewer who did not write `src/ui/Logins.tsx` or `accounts.css` and did not start from
part one's verdicts. The `commit:` line above names the commit this part was made on; part one's screenshots were
taken just before the one change below (the hold's day), which touched only the hold sentence.

⚠️ DEGRADED: single-context (the reviewer is itself a sub-agent and has none to start). `impeccable context` and
`impeccable detect src/ui/Logins.tsx` did run: the detector found nothing. The live overlay did not run.

Looked at: `real-*` (a real Claude Code login and a Codex login, light and dark, 1440 and 390) and the stand-in
states (`accounts-limits-*`, same four), kept in the run's evidence, not in the repository. The real login's
screenshots show real usage and stay there.

Findings are listed with `R` numbers so that part one's counts stay its own.

counts (part two): P0=0 P1=1 P2=4 P3=2

### R1 [P1] A hold is said as a time of day alone (fixed)
where: the "On hold until ..." line in `Logins.tsx`
what: a hold that ends on another day (a weekly window) read "until 6:59 AM", which a person takes as this morning or
this evening. The glance this page is for would be wrong by days.
fix: the line says the weekday and date when the end is not today. `src/ui/logins-hold.test.tsx` failed first.

### R2 [P2] A meter at 92% is drawn the same as one at 41% (open)
where: `.window meter`
what: only a small diamond and "Near a limit" in the head tell a full window from an easy one; the fill does not
change. In two seconds the eye finds the meter, not the diamond.
fix: none made. A different fill would need a colour with a meaning (DESIGN.md allows five); a longer fill is
already there. Decide with the owner.

### R3 [P2] "Near a limit" does not say which window
where: the login head
what: with three windows and a count it makes the person look down the rows for the diamond.
fix: name it in the head ("Near a limit: Current week (Fable)").

### R4 [P2] Logins are listed in the order they were added, not worst first
where: `Logins`
what: a login on hold or near a limit can sit under three calm ones.
fix: sort the marked ones first.

### R5 [P2] A reading is never called old
where: "Read 3 days ago"
what: the age is said, but a stale reading looks like a fresh one except for that line.
fix: say "old" in words past some age, or read again at once (the page already does when it opens).

### R6 [P3] "Current week (one model)" is a name the CLI never prints
where: `parseUsage` placeholder, shown on a login with no named-model week
what: it reads as a window that exists and was not reported. Honest, but vague.
fix: "Current week (a named model)".

### R7 [P3] "None set. It is set with --limit when the login is added." repeats on every login
where: the factory's own count
what: four logins, four copies of the same instruction.
fix: say it once under the list, leave "None set" on each.

No P0 is open and the P1 is fixed.
