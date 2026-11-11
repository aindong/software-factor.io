# What the factory has done on itself

Software Factor.io works on its own repository with the `full-loop` workflow (in the runs below it had another name, its author's own skills and its own plan check): `.factor/` holds the workflow,
the commands that check and ship a change here, and a backlog (`.factor/tasks.md`). This page is the honest
record of those runs: what landed, what did not, and what each run showed to be wrong with the factory.

The author role runs on Claude Code (Sonnet) and the reviewer role on Codex, both on the author's own
subscription logins. Costs are what the same usage would cost on an API key: nothing was billed per token. The
checkpoints (the plan, and the ship) were approved by the AI agent that the author set to build this project,
acting as the operator. No person read a plan before it was approved.

## The runs

All seven were made on 2026-11-11. A lane run is one visit of an agent lane. An agent start is one start of a
CLI: a plan that is sent back by its gate starts again, and a review is a panel of four.

| Run | Task | Result | Agent lane runs | Agent starts | Times sent back | Tokens | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `c5aef240` | Print the version with `softwarefactor --version` | Stopped at the impact lane. Not merged. | 5 | 7 | 1 | 1,371,014 | $0.88 |
| `b5da8a75` | `softwarefactor cost --json` | Done, merged by the ship lane | 4 | 8 | 0 | 3,567,831 | $1.56 |
| `305dea50` | `softwarefactor eval --list` | Done, merged by the ship lane | 4 | 8 | 0 | 2,638,417 | $1.35 |
| `e25d7a2c` | `softwarefactor cost` leaves no database behind | Done, merged by the ship lane | 4 | 7 | 0 | 1,760,051 | $0.74 |
| `75da76ff` | `softwarefactor eval --compare` refuses a broken result | Stopped at the review lane. Not merged. | 7 | 13 | 1 | 2,885,307 | $1.09 |
| `3c8fbf3b` | `softwarefactor requeue <run>` | Done, merged by the ship lane | 4 | 8 | 0 | 3,182,994 | $1.30 |
| `6a0ef719` | `softwarefactor --version` (second try) | Done, merged by the ship lane | 7 | 13 | 1 | 2,740,306 | $1.03 |

Five tasks landed, each merged into `main` by the factory's own ship lane, and the project's whole check passed
on `main` after each. None was sent back more than once. Two runs stopped, both on faults of the factory and not
of the work. In all: 35 agent lane runs, 64 agent starts, 18.1 million tokens, $7.95 at list prices. A landed
task cost $1.20 on average, and $1.97 went into the two runs that stopped.

`softwarefactor cost --check` was run after the last one: 64 sessions on 7 lanes, 64 transcripts re-read (32 of
Claude Code, 32 of Codex), and the report matched the session records to the token. Of everything that went
in, 89% was read from a cache.

From the fourth run on, the reviewers ran on a cheaper Codex model. A panel of four then cost about $0.14,
against about $0.80 before.

## What each run showed

- **`softwarefactor cost --json`.** The impact lane named a side effect nobody asked about: the new flag is
  declared once for every command, so `runs --json` no longer fails as an unknown option. It is silently
  accepted there.
- **`softwarefactor --version`, second try.** The review found a real fault and sent the work back: the plan
  said words after `version` are ignored, and they raised an error. The build lane fixed it and added a test,
  and the second review passed. This is the one run where a review changed the result.
- **Every review.** The four reviewers work in a read-only sandbox and cannot start the test runner there. Each
  says so in its hand-off and checks by reading and by running the command itself.

## The two runs that stopped

**The version command, first try.** The plan and the build passed every gate. The impact lane then failed twice
on its hand-off: its `proof` output must be one of five words, and the agent wrote a sentence. The lane's prompt
named the output and its type, and never said which values are allowed. Fixed: the prompt now gives each
output's kind, its allowed values and whether it is required, and the lane has one more try at a rejected
hand-off.

**`eval --compare`.** The work passed its gates twice. One reviewer of the panel passed the change and, as
evidence, named the impact lane where a gate belongs. The host rejected that hand-off, the rejection counted as
that reviewer's "fail", the task went back to build, build had nothing to change, and the same thing happened
again. A reviewer's "pass" had become a "fail" over how it was written down. Fixed: a panel member whose hand-off
is rejected for its form is started once more with the reason, and the prompt says that a lane is not a gate.

Neither was merged by hand: a task counts here only when it went through the factory. The version task was
written into the backlog again and landed on its second try.

## What else was wrong, and what was done

- **A stopped task could not be queued again.** The only way was to write the task anew. The need became a
  task, and the factory built it: `softwarefactor requeue <run>`.
- **The plan's first contract was often not in the form its gate reads.** The gate caught it and the agent
  repaired it, at the price of one more agent start. Not fixed: the plan lane's prompt could show the form.
- **The linter rejected the factory's own files.** The workflow file in `.factor/` is written in the factory's
  format, which is not the project formatter's. Here the linter now leaves `.factor/` alone. Any project with a
  formatter that reads JSON will meet this.
- **`node --test` was not counted.** The gate that compares test counts could not read the summary node's own
  runner prints, so it failed every project on that runner. Found by running the shipped workflows on a small
  project, not by these runs. Fixed.
- **`softwarefactor run` after `approve` starts the next task.** `approve` already carries the run on. Typing
  both started a second task's plan lane before the first run had been looked at. Nothing was lost, and the
  operator's habit was wrong, but the two commands read as a pair.
- **Two tests timed out while agents and gates worked beside the suite.** The tests now wait a minute.
- **A working run was hard to tell from a finished one in the interface, and what an agent printed was raw
  lines.** The owner saw both while watching these runs. Both are mended: a working run is marked and its line
  moves, and a session reads as an account of what the agent did.
- **A plan was approved unread by a person.** The factory asked, as it should. Who answers is outside its power.

## How to read this yourself

Every run keeps its evidence under `.factor/runs/<run>/` on the machine that ran it: each lane's hand-off, each
gate's output, and what each agent's CLI printed. `softwarefactor runs <run>` lists them, and `softwarefactor ui`
shows a run with each piece of evidence one key press away. Those folders are not committed. The plans the runs
wrote are in `docs/plans/`.
