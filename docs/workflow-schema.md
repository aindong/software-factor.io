# The workflow file

A workflow is one JSON file that says how work moves through your factory: where tasks come from, the lanes they
pass through, what checks each lane's work, and where a person steps in. It holds no secret and no account name,
so you can hand the file to someone else and it runs on their machine.

The words used here are defined in [CONTEXT.md](../CONTEXT.md). The reasons are in
[ADR 0012](adr/0012-workflow-shape.md). The machine-readable schema is
[schema/workflow.v1.json](../schema/workflow.v1.json), generated from `src/core/schema/workflow.ts`.

Check a file with `pnpm run schema:check path/to/workflow.json`. Every problem names the place and what to change.

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
| `core/wait@1` | Waits, without using the run's minutes. | `minutes` for a fixed wait. Or `until` (a command, as above) polled every `everyMinutes` until it exits 0, with `timeoutHours` after which the outcome is `needsPerson`. |

Use the `command` form in a workflow you share, so it does not assume one project's tooling.

**Agent settings.** `agent.role` says who, `agent.access` says whether it may change files (`read` or `write`),
and `agent.prompt` is the instruction, inline or `{ "file": "path" }` beside the workflow. Optional: `tier`
(`small`, `medium`, `large`: each machine maps these to real models), `effort` (`low`, `medium`, `high`, `max`),
`skills`, `mcp`, and `session` (`"new"`, or `{ "continue": "<lane>" }` to carry on the session another lane with
the same role left).

**Values in and out.** A lane declares the named values it produces in `outputs`, and the values it needs in
`inputs`, as `<lane>.outputs.<name>`. An input from a lane that has not run yet is empty. An agent lane gets its
inputs in its prompt and reports outputs in its hand-off. A command gets each input as an environment variable
`FACTOR_INPUT_<NAME>` and writes its outputs as one JSON object to the file named by `FACTOR_OUTPUTS`. A gate
command gets the lane's outputs as `FACTOR_OUTPUT_<NAME>`. No value is ever pasted into a command line.

**Limits.** `limits` may set `minutes`, `tokens`, `usd`, `turns` and `repairRounds`. A lane can only lower the
run's limits. `retry: { "max": 1 }` restarts a lane after a crash. A retry is not a round.

Rules the checker keeps:

- A lane that can write must have at least one gate.
- A lane marked `"oneWay": true` does something that cannot be undone. Its checkpoint must be `in`, it cannot be
  retried, and no transition may lead back into it.
- A panel can only read. Two agents writing at once is a known limit.

### Outcomes and transitions

A lane ends with one of three outcomes: `pass`, `fail` or `needsPerson`. `on` says where the task goes for each.
`pass` and `fail` are required. `needsPerson` defaults to `@inbox`.

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
  `<lane>.gates.<gate>` (`pass` or `fail`). The checker rejects a value the `ref` can never have.
- An entry with both `when` and `maxRounds` applies only while both hold.

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
| `core/protected-paths@1` | The change touches no protected path. | Optional `paths` (globs). Default: CI folders, agent config, lock files. |
| `core/tests-not-weakened@1` | No test was deleted, skipped or lost its checks. | Optional `testGlobs`. |
| `core/test-floor@1` | At least as many tests run as on the base commit, and more than zero. | Optional `command` (default `verify`). |
| `core/new-tests-fail-on-base@1` | Test files that are new or grew fail on the base commit. | Optional `command`, `testGlobs`. |

### Checkpoints

`in`: a person approves. `near`: the host tells the person and goes on. `out`: no notice, audited later.

When the person is asked depends on what they are approving. An agent's work is approved after it is done and
its gates have passed, before the transition. A command, a wait, or anything marked `oneWay` is approved before
it runs, because afterwards is too late. At an `in` checkpoint the person can approve, send the work back with a
note (the lane runs again with the note), or reject it, which is the outcome `fail`.

A lane earns a move from `in` towards `out` by its record (ADR 0011). The file holds the lane's current
checkpoint, and the factory changes it only when a person accepts a suggestion. `"pin": true` keeps the ladder
from ever moving a lane. A one-way lane is always pinned at `in`. When a workflow is imported, lanes that do not
wait for a person are listed, and by default set to `in`: the record that earned them belongs to another machine.

### Hand-offs

Each lane leaves a hand-off: what it did, the evidence for each claim, what is still open, and the risk. The host
checks the declared outputs before any transition, and rejects a claim with no evidence.

### Panels

A panel runs several agents on the same lane at once, each starting from the lane's `agent` settings and
overriding `role`, `prompt`, `tier` or `effort`. `join` is `all` or `any`. A member with `"advisory": true` is
reported but never decides the outcome. A member with `when` only joins when the condition holds, which is how a
review is sized to the change.

## Collectors

| Collector `uses` | Finds tasks in | `with` |
| --- | --- | --- |
| `core/file@1` | A markdown file in the workspace. | `path`, inside the workspace. |
| `core/github-issues@1` | Open issues with a label. | `label`, optional `repo` as `owner/name`. |
| `core/schedule@1` | A clock: one task each time it fires. | `cron` (five fields), `title`, `body`. |
| `core/mcp-query@1` | The result of one MCP tool call. | `server` (declared in `mcp`), `tool`, optional `args`. |

## What stays out of the file

Accounts, tokens, the real model names, canvas positions and anything about past runs. MCP entries list the names
of environment variables, never their values. The checker rejects text that looks like a credential anywhere in
the file, and a prompt file path that leaves the workflow's folder.
