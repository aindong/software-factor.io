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
| `roles` | Every role a lane names, with a description. Each machine binds roles to accounts. A workflow never names an account. |
| `limits` | The budget for one run: `minutes` and `tokens`, and optionally `usd`. A lane can only lower it. |
| `collectors` | Where tasks come from. Built in: `core/file@1`, `core/github-issues@1`, `core/schedule@1`, `core/mcp-query@1`. |
| `gates` | The checks the host can run, by id. Lanes pick from this list. |
| `lanes` | The steps, in order. A run starts at the first lane. |
| `mcp`, `skills` | Every MCP server and skill a lane names, and where each comes from. |
| `plugins` | The plugin namespaces this file uses, each with a version range. |

## Lanes

Every lane has an `id` (transitions point at ids), a type in `uses`, a `checkpoint`, and an `on` map.

- **`core/agent@1`** runs an agent. `agent.role` says who, `agent.access` says whether it may change files
  (`read` or `write`), and `agent.prompt` is the instruction, inline or `{ "file": "path" }`. Optional: `tier`
  (`small`, `medium`, `large`: each machine maps these to real models), `effort`, `skills`, `mcp`, and `session`
  (`"new"`, or `{ "continue": "<lane>" }` to carry on the session another lane left).
- **`core/command@1`** runs a command on the host with no model: `with.run` is a shell command, and
  `with.command` names a command the workspace defines in `.factor/factory.json`, such as `verify` or `ship`. Use
  the second form in a workflow you share, so it does not assume one project's tooling.

A lane that writes must have at least one gate. A lane marked `"oneWay": true` does something that cannot be
undone, so its checkpoint must be `in`.

### Outcomes and transitions

A lane ends with one of three outcomes: `pass`, `fail` or `needsPerson`. `on` says where the task goes for each.
`pass` and `fail` are required. `needsPerson` defaults to `@inbox`.

A transition is a lane id, or one of three ends: `@done` (the run finished), `@stop` (the run ended and a person
takes over, with what is still open), `@inbox` (wait for a person, then run the lane again).

It can also be a list, tried in order. The first entry that applies wins, and the last entry is a plain default:

```json
"on": {
  "pass": [{ "to": "verify-ui", "when": { "ref": "change.tier", "in": ["ui"] } }, { "to": "ship" }],
  "fail": [{ "to": "build", "maxRounds": 2 }, { "to": "@stop" }]
}
```

- **Loops must be bounded.** A transition that points at the same lane or an earlier one must carry `maxRounds`.
  The host counts how often it was taken in this run. When the rounds run out, the next entry applies.
- **Conditions are data.** `when` names a value with `ref` and compares it with `in` or `notIn`. There are no
  expressions. `ref` can be `task.source`, `task.labels`, `change.tier` (`docs`, `refactor`, `api`, `ui`,
  `sensitive`), `<lane>.outputs.<name>`, or `<lane>.gates.<gate>` (`pass` or `fail`).
- **`retry`** restarts a lane after a crash. A retry is not a round.

### Gates

A gate is a check the host runs on the lane's committed work after the agent has finished. The agent never runs
or grades its own gate. `onFail` says what a failure means:

| `onFail` | Meaning |
| --- | --- |
| `repair` | Send the output back to the same agent session. The lane's `limits.repairRounds` caps how often. |
| `fail` | The lane's outcome is `fail`. |
| `stop` | The run stops and nothing is sent back. Use it for rules an agent must never be asked to work around. |
| `inform` | Recorded and shown, never blocking. |

Built in: `core/command@1`, `core/protected-paths@1`, `core/tests-not-weakened@1`, `core/test-floor@1`,
`core/new-tests-fail-on-base@1`. A command gate gets the lane's outputs as environment variables named
`FACTOR_OUTPUT_<NAME>`, so no value is ever pasted into a command line.

### Checkpoints

`in`: the host waits for a person to approve the lane's work. `near`: the host tells the person and goes on.
`out`: no notice, audited later. A lane earns a move from `in` towards `out` by its record (ADR 0011).

### Hand-offs, inputs and outputs

Each lane leaves a hand-off: what it did, the evidence for each claim, what is still open. `outputs` declares the
named values the next lanes may use, and the host checks them before any transition. `inputs` names the values a
lane's prompt receives, as `<lane>.outputs.<name>`.

### Panels

A panel runs several agents on the same lane at once, each starting from the lane's `agent` settings and
overriding part of them. `join` is `all` or `any`. A member with `"advisory": true` is reported but never decides
the outcome. A member with `when` only joins when the condition holds, which is how a review is sized to the
change.

## What stays out of the file

Accounts, tokens, the real model names, canvas positions and anything about past runs. MCP entries list the names
of environment variables, never their values.
