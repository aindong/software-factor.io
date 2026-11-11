# What the factory has done on itself

Software Factor.io works on its own repository with the `alleo-loop` workflow: `.factor/` holds the workflow,
the commands that check and ship a change here, and a backlog (`.factor/tasks.md`). This page is the honest
record of those runs: what landed, what did not, and what each run showed to be wrong with the factory.

The author role runs on Claude Code (Sonnet) and the reviewer role on Codex, both on the author's own
subscription logins. Costs are what the same usage would cost on an API key: nothing was billed per token. The
checkpoints (the plan, and the ship) were approved by the AI agent that the author set to build this project,
acting as the operator. No person read a plan before it was approved.

## The runs

| Task | Result | Agent lane runs | Agent starts | Fix rounds | Tokens | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Print the version with `softwarefactor --version` | Stopped at the impact lane. Not merged. | 5 | 7 | 1 | 1,371,014 | $0.88 |
| `softwarefactor cost --json` prints the report as JSON | Done. Merged by the factory's own ship lane. | 4 | 8 | 0 | 3,567,831 | $1.56 |

One task has landed. The backlog's other tasks have not been started: the project's own rule caps real-agent
lane runs at ten a day, and these two runs used nine.

`softwarefactor cost --check` was run after them: 15 sessions on 7 lanes, 15 transcripts re-read (11 of Claude
Code, 4 of Codex), and the report matched the session records to the token. The cache hit rate was 90%.

### `softwarefactor cost --json`: done

- **Plan** (Claude): a plan with four acceptance criteria and four failing tests, in `docs/plans/`. Its first
  hand-off was rejected by the gate that reads the plan's contract, and its second passed.
- **Build** (Claude): the change, in one start. All five gates passed on a clean checkout: protected paths,
  tests kept, the project's own checks, the test count, and the new tests failing without the change.
- **Impact** (Claude): it named a side effect nobody asked about. The new flag is declared once for every
  command, so `runs --json` no longer fails as an unknown option. It is now silently accepted there.
- **Review** (Codex, a panel of four): correctness, requirements, a skeptic and maintainability each passed it.
  All four named the same limit: in their read-only sandbox they could not start the test runner, so they
  checked by reading and by running the command itself.
- **Ship**: approved, then the factory merged the run's branch into `main`. The project's whole check passed on
  `main` afterwards.

### `softwarefactor --version`: stopped

The plan and the build passed every gate. The impact lane then failed twice on its hand-off: the lane's `proof`
output must be one of five words (`claimed`, `cited`, `argued`, `run`, `reproduced`), and the agent wrote a
sentence. The fault was the factory's. The lane's prompt named the output and its type, and never said which
values are allowed. The workflow sent the task back to build, build had nothing to change, and the second
impact visit failed the same way.

The work is on the run's branch, unreviewed. It has not been merged by hand: a task counts here only when it
went through the factory. The task is in the backlog again.

## What the runs showed to be wrong, and what was done

- **A prompt did not say what an output may be.** Fixed: the prompt now gives each output's kind, its allowed
  values and whether it is required, and the impact lane of `alleo-loop` has one more try at a rejected
  hand-off.
- **The plan's first contract was not in the form its gate reads**, in both runs. The gate caught it and the
  agent repaired it, at the price of one or two more agent starts per plan. Not fixed: the plan lane's prompt
  could show the form.
- **The linter rejected the factory's own files.** The workflow file in `.factor/` is written in the factory's
  format, which is not the project formatter's. Here the linter now leaves `.factor/` alone. Any project with a
  formatter that reads JSON will meet this.
- **`node --test` was not counted.** The gate that compares test counts could not read the summary node's own
  runner prints, so it failed every project on that runner. Found by running the shipped workflows on a small
  project, not by these two runs. Fixed.
- **A stopped task cannot be queued again.** The only way is to write the task anew. A command for it is now in
  the backlog.
- **`softwarefactor run` after `approve` starts the next task.** `approve` already carries the run on. Typing
  both started a second task's plan lane before the first run had been looked at. Nothing was lost, and the
  operator's habit was wrong, but the two commands read as a pair.
- **Reviewers in a read-only sandbox cannot run the tests.** The panel says so in each hand-off. A review lane
  that needs to run them wants a writable copy of its own, which the factory does not give a panel yet.
- **A plan was approved unread by a person.** The factory asked, as it should. Who answers is outside its power.

## How to read this yourself

Every run keeps its evidence under `.factor/runs/<run>/` on the machine that ran it: each lane's hand-off, each
gate's output, and what each agent's CLI printed. `softwarefactor runs <run>` lists them, and `softwarefactor ui`
shows a run with each piece of evidence one key press away. Those folders are not committed.
