# The workflow file

A workflow is one JSON file that says how work moves through your factory: where tasks come from, the lanes they
pass through, what checks each lane's work, and where a person steps in. It holds no secret and no account name,
so you can hand the file to someone else and it runs on their machine.

The words used here are defined in [CONTEXT.md](../CONTEXT.md). The reasons are in
[ADR 0012](adr/0012-workflow-shape.md). The machine-readable schema is
[schema/workflow.v1.json](../schema/workflow.v1.json), generated from `src/core/schema/workflow.ts`.

Check a file with `softwarefactor check path/to/workflow.json`, or every workflow in the workspace with
`softwarefactor check`. Every problem names the place and what to change.

## The smallest workflow

```json
{
  "$schema": "https://softwarefactor.io/schema/workflow/v1.json",
  "version": 1,
  "name": "tiny",
  "description": "Fix a task from a local file and stop for a person.",
  "roles": { "author": { "description": "Writes the change." } },
  "limits": { "minutes": 30, "tokens": 2000000 },
  "collectors": [{ "id": "tasks", "uses": "core/file@1", "with": { "path": ".factor/tasks.md" } }],
  "gates": {
    "verify": { "uses": "core/command@1", "with": { "command": "verify" }, "onFail": "repair" }
  },
  "lanes": [
    {
      "id": "fix",
      "uses": "core/agent@1",
      "agent": { "role": "author", "access": "write", "prompt": "Do the task. Commit your work." },
      "gates": ["verify"],
      "checkpoint": "in",
      "limits": { "repairRounds": 2 },
      "on": { "pass": "@done", "fail": "@stop" }
    }
  ]
}
```

## Top level

| Key | Meaning |
| --- | --- |
| `$schema`, `version` | Required. Editors use the first for completion. The loader refuses a newer `version` and asks you to upgrade. |
| `name`, `description` | What this process is for. |
| `roles` | Every role a lane names, with a description. Each machine binds roles to accounts. A workflow never names an account. `differentVendorFrom` lists roles this one should not share a vendor with: the machine binds it to another vendor when it has one, and warns when it cannot. |
| `limits` | The budget for one run: `minutes` and `tokens`, and optionally `usd`. A lane can only lower it. |
| `commands` | Every workspace command a lane or gate names, each with a description of what it must do. The workspace defines them in `.factor/factory.json`. A name starts with a letter and may use letters, digits, `.`, `:`, `_` and `-`. |
| `collectors` | Where tasks come from. Built in: `core/file@1`, `core/github-issues@1`, `core/schedule@1`, `core/mcp-query@1`. |
| `gates` | The checks the host can run, by id. Lanes pick from this list. |
| `lanes` | The steps, in order. A run starts at the first lane. |
| `mcp`, `skills` | Every MCP server and skill a lane names, and where each comes from. |
| `plugins` | The plugin namespaces this file uses, each with a version range. |

## Lanes

Every lane has an `id` (transitions point at ids), a type in `uses`, a `checkpoint`, and an `on` map. A lane may
also have a `name` and `description` for people, and a free-form `meta` object that the factory ignores.

| `uses` | What it does | `with` |
| --- | --- | --- |
| `core/agent@1` | Runs an agent. | None. The settings are in `agent`. |
| `core/command@1` | Runs a command on the host, with no model. Exit 0 is `pass`, anything else is `fail`. | Exactly one of `run` (a shell command) or `command` (a name the workspace defines in `.factor/factory.json`, such as `verify` or `ship`). Optional `timeoutMinutes`. |
| `core/wait@1` | Waits, without using the run's minutes. | `minutes` for a fixed wait of at most one week, which always ends `pass`. Or `until` (a command, as above) checked every `everyMinutes` until it exits 0, with `timeoutHours` (at most 30 days) after which the outcome is `needsPerson`. Both are required with `until`. The command may write outputs when it exits 0. |

Use the `command` form in a workflow you share, so it does not assume one project's tooling.

**Agent settings.** `agent.role` says who, `agent.access` says whether it may change files (`read` or `write`),
and `agent.prompt` is the instruction, inline or `{ "file": "path" }` beside the workflow. Optional: `tier`
(`small`, `medium`, `large`: each machine maps these to real models), `effort` (`low`, `medium`, `high`, `max`),
`skills`, `mcp`, and `session` (`"new"`, or `{ "continue": "<lane>" }` to carry on the session an earlier lane with the same role left; not a
panel, which leaves several).

**Values in and out.** A lane declares the named values it produces in `outputs`, and the values it needs in
`inputs`, as `<lane>.outputs.<name>`. Names use letters and digits and start with a lowercase letter, such as `planPath`. An input from a lane that has
not run yet is empty, and a lane that loops on itself reads its own last round's value. An agent lane gets its
inputs in its prompt and reports outputs in its hand-off. A command gets each input as an environment variable
`FACTOR_INPUT_<NAME>` and writes its outputs as one JSON object to the file named by `FACTOR_OUTPUTS`. A gate
command gets the lane's outputs as `FACTOR_OUTPUT_<NAME>`. No value is ever pasted into a command line.

**Limits.** `limits` may set `minutes`, `tokens`, `usd`, `turns` and `repairRounds`. A lane can only lower the
run's limits. When a lane passes its own minutes, its agent is stopped and the lane's outcome is `fail`. When the
run has used its minutes, tokens or dollars, no further lane starts and the run stops for a person. Time spent
waiting, for a person or in a wait lane, is not counted. `retry: { "max": 1 }` restarts an agent that crashed
without a hand-off. A retry is not a round.

Rules the checker keeps:

- An agent lane that can write must have at least one gate. A command lane with no gate must not commit to the
  run's branch: the host fails it if it does, because nothing would check that commit.
- A lane marked `"oneWay": true` does something that cannot be undone, so it runs at most once in a run. Its
  checkpoint must be `in`. It cannot be retried, cannot have a `repair` gate, cannot go to `@inbox` (write
  `"needsPerson": "@stop"`), and no later lane may loop back to it or past it.
- A panel can only read. Two agents writing at once is a known limit.

### Outcomes and transitions

A lane ends with one of three outcomes: `pass`, `fail` or `needsPerson`. `on` says where the task goes for each.
`pass` and `fail` are required. `needsPerson` defaults to `@inbox`. An agent that asks for a person has not
finished, so its gates are not run: there is nothing to judge yet.

A transition is a lane id, or one of four ends:

| End | Meaning |
| --- | --- |
| `@done` | The run finished and its work landed. |
| `@drop` | This was not work after all (a false alarm, a duplicate). Counted apart from landed work. |
| `@stop` | The run ended and a person takes over, with a hand-off listing what is still open. |
| `@inbox` | Wait for a person. Their answer is added to the lane's input and the lane runs again. |

A transition can also be a list, tried in order. The first entry that applies wins, and the last entry is a plain
default:

```json
"on": {
  "pass": [{ "to": "verify-ui", "when": { "ref": "change.tier", "in": ["ui"] } }, { "to": "ship" }],
  "fail": [{ "to": "build", "maxRounds": 2 }, { "to": "@stop" }]
}
```

- **Loops must be bounded.** A transition that points at the same lane or an earlier one must carry `maxRounds`.
  The host counts how often it was taken in this run. When the rounds run out, the next entry applies.
- **Conditions are data.** `when` names a value with `ref` and compares it with exactly one of `in` or `notIn`.
  There are no expressions and no numeric comparisons. `ref` can be `task.source`, `task.labels`, `change.tier`
  (`docs`, `refactor`, `api`, `ui`, `sensitive`, known once there is a change), `<lane>.outputs.<name>`, or
  `<lane>.gates.<gate>` (`pass` or `fail`). `task.source` is the id of the collector that found the task.
  `change.tier` needs a lane that can write. The checker rejects a value the `ref` can never have: a collector
  that does not exist, a tier that is not one of the five, text against a yes-or-no output.
- An entry with both `when` and `maxRounds` applies only while both hold.
- **A round must bring something new.** When a loop goes back to a lane that writes and that lane made no new
  commit since the last round, the run stops instead of going round again.

### How a run ends

Every run ends, or waits, with a code that can be counted:

| Code | Meaning |
| --- | --- |
| `done`, `dropped` | The run reached `@done` or `@drop`. |
| `lane_failed` | A lane's `fail` led to `@stop`. |
| `rejected` | A person rejected a lane's work and that led to `@stop`. |
| `out_of_rounds` | A loop had no rounds left and its default was `@stop`. |
| `no_progress` | A loop came round with no new commit. |
| `budget_minutes`, `budget_tokens`, `budget_usd` | The run used its budget. |
| `gate_stop` | A gate with `onFail: "stop"` failed. |
| `git_config_changed` | Git's configuration or hooks changed while an agent worked. |
| `interrupted`, `crashed` | The command was stopped, or the engine hit an error. |
| `awaiting_approval`, `needs_person`, `waiting` | The run is parked: for an approval, for an answer, or in a wait lane. |
| `account_limit` | The run is parked: the account of its next lane is near its limit. `softwarefactor run` continues it when the account has room. |

### Gates

A gate is a check the host runs on the lane's committed work after the lane has finished. The agent never runs
or grades its own gate. `onFail` says what a failure means:

| `onFail` | Meaning |
| --- | --- |
| `repair` | Send the output back to the same agent session. The lane's `limits.repairRounds` caps how often. Only on agent lanes. |
| `fail` | The lane's outcome is `fail`. |
| `stop` | The run stops and nothing is sent back. Use it for rules an agent must never be asked to work around. |
| `inform` | Recorded and shown, never blocking. |

| Gate `uses` | Checks | `with` |
| --- | --- | --- |
| `core/command@1` | A command exits 0 on a fresh checkout of the lane's work. | `run` or `command`, optional `timeoutMinutes`. |
| `core/protected-paths@1` | The change touches no protected path: the factory's own `.factor/` folder, CI folders, agent configuration (`.claude/`, `.codex/`, `CLAUDE.md`, `AGENTS.md`, `.mcp.json`), git attributes and submodules (the pointer included), and lock files. Letter case is ignored. | Optional `paths` (globs), added to that list. The workspace can add more in `factory.json` under `protectedPaths`. |
| `core/tests-not-weakened@1` | No test file was deleted (a rename with the same content is fine), no file has fewer tests, no more tests are marked skip, todo or only, no assertion in an existing test changed or was removed (moving a line is fine), and no script that existed in `package.json` changed. Comments are ignored, so a test that is commented out counts as removed. | Optional `testGlobs`. |
| `core/test-floor@1` | At least as many tests ran (passed or failed, not skipped) as on the base commit, and more than zero. The base commit is measured once per run. It fails when either count cannot be read. | Optional `command` (default `verify`), `timeoutMinutes`, and `pattern` (a regular expression with one group of digits) for a runner whose output is not recognised. |
| `core/new-tests-fail-on-base@1` | The base commit's suite must pass on its own. Then test files that are new or grew are put on a fresh checkout of the base commit and the suite is run there. It must fail. With no new tests the gate passes and says so. | Optional `command` (default `verify`), `testGlobs`, `timeoutMinutes`. |
| `core/no-secrets@1` | No line that any commit of the change added looks like a secret (a token, a private key, a password in a URL), also when a later commit took it out. What is found is named by file, line, commit and its first characters. A secret that was already there is not this lane's. See [evals](evals.md). | None. |

**What these gates cannot see.** They count patterns, they do not parse or run your tests one by one. A test
switched off by code (an early `return`), a test moved to another file (reported as fewer tests, for a person to
confirm), and a new test that fails on the base commit only because it cannot load a new file are beyond them.
Review is for those.

**Where gates run.** The host makes one fresh checkout of the commit the lane left, for all the gates of that
attempt, and removes it afterwards. If the workspace defines a `setup` command in `factory.json`, it runs once in
each checkout before any gate, so gates find the project installed. A setup that fails fails the lane, with its
output as evidence. Gates that look only at the change (protected paths, tests not weakened) read git and need no
checkout.

**What a gate still trusts.** A command gate runs the project's own scripts from the agent's commit. The
protected paths and the script check narrow what an agent can change to make a gate pass. They do not make a local
run a sandbox.

### Checkpoints

`in`: a person approves. `near`: the host tells the person and goes on. `out`: no notice, audited later.

When the person is asked depends on what they are approving. An agent's work is approved after it is done and
its gates have passed, before the transition. A command, a wait, or anything marked `oneWay` is approved before
it runs, because afterwards is too late. At an `in` checkpoint after an agent's work, the person can approve, send the work back with a note (the lane
runs again with the note), or reject it, which is the outcome `fail`. Before a command or a wait there is no work
to send back, so the choice is approve or reject.

A lane earns a move from `in` towards `out` by its record (ADR 0011). The file holds the lane's current
checkpoint, and the factory changes it only when a person accepts a suggestion. `"pin": true` keeps the ladder
from ever moving a lane, at whatever checkpoint it has, and an import keeps the pin. A one-way lane is always pinned at `in`. When a workflow is imported, lanes that do not
wait for a person are listed, and by default set to `in`: the record that earned them belongs to another machine.
`softwarefactor export` and `softwarefactor import` are described in `docs/sharing.md`.

### Hand-offs

Each lane leaves a hand-off: what it did, the evidence for each claim, what is still open, and the risk. The host
checks the declared outputs before any transition, and rejects a claim with no evidence.

### Panels

A panel runs several agents on the same lane at once, each starting from the lane's `agent` settings and
overriding `role`, `prompt`, `tier` or `effort`. `join` is `all` or `any`. A member with `"advisory": true` is
reported but never decides the outcome. A member with `when` only joins when the condition holds, which is how a
review is sized to the change. How a panel runs and how its verdict is joined is in `docs/panels.md`.

## Collectors

| Collector `uses` | Finds tasks in | `with` |
| --- | --- | --- |
| `core/file@1` | A markdown file in the workspace. | `path`, inside the workspace. |
| `core/github-issues@1` | Open issues with a label, read with `gh`. Their labels become the task's. | `label`, optional `repo` as `owner/name`. |
| `core/schedule@1` | A clock: a task for the latest time the schedule was due, in local time, collected at the next `collect` or `run`. | `cron` (five fields), `title`, `body`. |
| `core/mcp-query@1` | A task for each item in the answer of one MCP tool call. | `server` (declared in `mcp`, started by a command), `tool`, optional `args`. |

Each collector is described with an example in `docs/collectors.md`.

## What stays out of the file

Accounts, tokens, the real model names, canvas positions and anything about past runs. MCP entries list the names
of environment variables, never their values. The checker rejects the common credential formats, a
`key=value` secret in a URL, and any value under a key named like a secret (`password`, `token`, `apiKey`). It
says which text matched. It also rejects a prompt file path that leaves the workflow's folder.

## Processes a skeptic tried

Before the format was fixed, a reviewer wrote ten real delivery processes as workflow files to find what it could
not say. The first pass found that seven needed a fake. The format changed (the `@drop` end, the wait lane, when a
checkpoint asks, `pin`, `differentVendorFrom`, declared commands, strict settings) and a second pass found none
faked. Each supported process is a fixture under `test/fixtures/workflows/hard-cases/`, checked on every test run.

| Process | Status | Fixture or reason |
| --- | --- | --- |
| Ticket: plan, a person approves, build, browser check, pull request, review comments come back for another round | supported | `ticket-plan-pr-review.json` |
| A monitoring alert that one agent must confirm is real before it becomes work | supported | `alert-verify.json` |
| A change to money or auth: threat model first, the full review panel, a person signs off | supported | `sensitive-change.json` |
| A nightly dependency update that bothers a person only when tests fail | supported | `nightly-deps.json` |
| A release: changelog, version, tag, staging, smoke test, a one-way production deploy | supported | `release.json` |
| A design task: one vendor makes the images, another builds, with a critique loop | supported | `design-critique.json` |
| A cheap triage that routes easy work to a small model and hard work to a large one | supported | `triage-route.json` |
| An epic split into child tasks that run in parallel and are then integrated | known limit | A lane cannot create tasks, run once per item of a list, or wait on other runs. One run is one line of work in one worktree. |
| A backend and a frontend built by two agents at the same time, then joined | known limit | Two agents writing at once need a worktree each and a merge step. A panel can only read, so the checker rejects this rather than let two writers share one tree. |
| A canary rollout in steps with a bake time and automatic rollback | known limit | Nothing runs when a run ends by budget, crash or a `stop` gate, so a half-finished rollout is not rolled back. Conditions cannot compare numbers, so an error-rate threshold lives inside a command. |

## Known limits

- **One writer per run.** Parallel work happens across tasks, each in its own worktree, and inside a read-only
  panel. Not between two writing agents in one run.
- **No child tasks.** A lane cannot file tasks for other runs or wait on them.
- **No clean-up lane.** There is no lane that always runs when a run ends. The host cleans up what it started
  (processes, ports, the worktree), but not what a command did to the outside world.
- **Conditions compare, they do not calculate.** `in` and `notIn` only. A threshold is a command's job.
- **One approver.** A checkpoint cannot name who may approve. The factory has one owner.
- **Collectors do not group.** Fifty alerts for one cause are fifty tasks. A first lane can drop duplicates with `@drop`.
- **`differentVendorFrom` is a preference.** A machine with one vendor warns and carries on.
- **The same lane twice for two model sizes.** `tier` cannot depend on a condition, so routing by size means two lanes.
