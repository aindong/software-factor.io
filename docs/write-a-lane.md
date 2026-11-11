# Write a lane

A lane is one step of your process: who does it, what it may touch, what checks it, whether a person looks, and
where the task goes next. You add one by editing the workflow file in `.factor/workflows/`, by hand or on the
floor in `softwarefactor ui`. This guide adds a review lane to the workflow that `softwarefactor init` writes.
Every field is described in [the workflow file](workflow-schema.md).

## The workflow with the new lane

```json
{
  "$schema": "https://softwarefactor.io/schema/workflow/v1.json",
  "version": 1,
  "name": "with-review",
  "description": "An agent does the task, a second agent reads the change, and a person approves the result.",
  "roles": {
    "author": { "description": "Does the task and commits the work." },
    "reviewer": {
      "description": "Reads the change and tries to break it.",
      "differentVendorFrom": ["author"]
    }
  },
  "limits": { "minutes": 60, "tokens": 4000000 },
  "commands": {
    "verify": { "description": "Runs this project's checks on a clean checkout. Exits 0 only when they pass." }
  },
  "collectors": [{ "id": "tasks", "uses": "core/file@1", "with": { "path": ".factor/tasks.md" } }],
  "gates": {
    "tests-kept": { "uses": "core/tests-not-weakened@1", "onFail": "stop" },
    "verify": { "uses": "core/command@1", "with": { "command": "verify" }, "onFail": "repair" }
  },
  "lanes": [
    {
      "id": "work",
      "name": "Work",
      "uses": "core/agent@1",
      "agent": {
        "role": "author",
        "access": "write",
        "prompt": "Do the task below. Commit your work. If you are here because the review failed, fix what its hand-off lists and nothing else."
      },
      "gates": ["tests-kept", "verify"],
      "checkpoint": "near",
      "limits": { "repairRounds": 2 },
      "on": { "pass": "review", "fail": "@stop" }
    },
    {
      "id": "review",
      "name": "Review",
      "uses": "core/agent@1",
      "agent": {
        "role": "reviewer",
        "access": "read",
        "prompt": "Read the change against the task. Fail the lane only for a fault you reproduced, and say how to reproduce it."
      },
      "outputs": { "findings": { "type": "array", "description": "Each fault, with how to reproduce it." } },
      "checkpoint": "in",
      "on": {
        "pass": "@done",
        "fail": [{ "to": "work", "maxRounds": 2 }, { "to": "@stop" }]
      }
    }
  ]
}
```

Save it as `.factor/workflows/with-review.json`, set `"workflow": "with-review"` in `.factor/factory.json`, and
run `softwarefactor check`. Every problem it finds names the place and what to change.

## What each part of the lane decides

- **`uses`** is the lane's type. `core/agent@1` runs an agent, `core/command@1` runs a command of yours with no
  model, `core/wait@1` waits. A plugin can bring more types: see [write a plugin](plugins.md#write-one).
- **`agent.role`** says who, not which model. The role is bound to a login on each machine with
  `softwarefactor role bind reviewer --account <name>`. `differentVendorFrom` asks for a second pair of eyes
  from another vendor, and `softwarefactor role list` flags it when both roles are on the same one.
- **`agent.access`** is `read` or `write`. A lane that writes must have at least one gate: an agent's claim is
  never the verdict. The review lane only reads, so it needs none.
- **`gates`** are checked by the host on a clean checkout of the commit the lane left. `onFail` says what a
  failure does: `repair` gives the agent the gate's output and another try, `fail` ends the lane as failed,
  `stop` ends the run for a person.
- **`outputs`** are named values the lane hands on. A later lane asks for one with
  `"inputs": { "findings": "review.outputs.findings" }`.
- **`checkpoint`** is where a person stands: `in` (you approve before the task moves on), `near` (you are told,
  and it goes on), `out` (no notice). A lane moves along these steps on its record: see
  [the autonomy ladder](ladder.md).
- **`on`** says where the task goes for each outcome. A transition back to an earlier lane must carry
  `maxRounds`, so no run goes round for ever. When the rounds run out, the next entry applies.

## A lane that runs a command

A step with no model, such as a deploy to a staging server, is a command lane. The command is named in the
workflow and defined in `.factor/factory.json`, so the workflow does not assume one project's tooling. Declare
the name under the workflow's `commands` too (`"stage": { "description": "Puts the change on staging." }`), so
whoever takes the workflow sees what they must define:

```json
{
  "id": "stage",
  "uses": "core/command@1",
  "with": { "command": "stage" },
  "checkpoint": "in",
  "on": { "pass": "@done", "fail": "@stop" }
}
```

```json
{ "version": 1, "workflow": "with-review", "commands": { "verify": "pnpm test", "stage": "./scripts/stage.sh" } }
```

A command lane is approved before it runs, because afterwards is too late. Its inputs arrive as
`FACTOR_INPUT_<NAME>`, and it finds the run in `FACTOR_RUN_ID` and the task's title in `FACTOR_TASK_TITLE`. It
runs in the run's own worktree, on the run's branch.

## A lane type of your own

When the same command lane is wanted in several repositories, put it in a plugin: a folder with a
`factor-plugin.json` that names the lane type and the command line behind it. `softwarefactor add` shows what
the plugin would run before it installs anything. The guide is [plugins](plugins.md), and `plugins/sample` in
this repository is a small one to copy.

## Try the lane before you trust it

- `softwarefactor check` reads the file.
- Bind the role to the scripted agent in `.factor/local.json` (as `init` does for `author`) and run a task: you
  see the lane's place in the run, its checkpoint and its transitions without spending anything.
- Then bind a real login, and keep the checkpoint at `in` until the lane has a record.
