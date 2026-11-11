# Write a lane

A lane is one step of your process: who does it, what it may touch, what checks it, whether a person looks, and
where the task goes next. You add one by editing the workflow file in `.factor/workflows/`, by hand or on the
floor in `softwarefactor ui`. This guide adds a lane to the workflow that `softwarefactor init` writes, which has
five: Plan, Build, Review, Test and Ship. Every field is described in [the workflow file](workflow-schema.md).

## The new lane

The starter has no lane that brings the documentation up to date. Add one after Test and before Ship:

```json
{
  "id": "docs",
  "name": "Docs",
  "uses": "core/agent@1",
  "agent": {
    "role": "author",
    "access": "write",
    "prompt": "Bring the README and the guides under docs/ up to date with the change. Change no code. Commit your work."
  },
  "gates": ["protected", "tests-kept"],
  "checkpoint": "in",
  "limits": { "repairRounds": 1 },
  "on": { "pass": "ship", "fail": "@stop" }
}
```

Put it in the `lanes` of `.factor/workflows/starter.json`, between `test` and `ship`, and change the `on` of
`test` so that it goes there: `"pass": "docs"`. Then run `softwarefactor check`. Every problem it finds names the
place and what to change. The lane writes, so it names gates (the two the starter already defines), and it
starts at `in`, so a person approves it until it has a record.

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
  `"inputs": { "plan": "plan.outputs.plan" }`, as the Build lane of the starter does.
- **`checkpoint`** is where a person stands: `in` (you approve before the task moves on), `near` (you are told,
  and it goes on), `out` (no notice). A lane moves along these steps on its record: see
  [the autonomy ladder](ladder.md).
- **`on`** says where the task goes for each outcome. A transition back to an earlier lane must carry
  `maxRounds`, so no run goes round for ever. When the rounds run out, the next entry applies.

## A lane that runs a command

A step with no model, such as a deploy to a staging server, is a command lane. The command is named in the
workflow and defined in `.factor/factory.json`, so the workflow does not assume one project's tooling. Declare
the name under the workflow's `commands` too (`"stage": { "description": "Puts the change on staging." }`), so
whoever takes the workflow sees what they must define. This lane goes between `docs` and `ship`, and the `on` of
`docs` goes to it (`"pass": "stage"`):

```json
{
  "id": "stage",
  "uses": "core/command@1",
  "with": { "command": "stage" },
  "checkpoint": "in",
  "on": { "pass": "ship", "fail": "@stop" }
}
```

```json
{ "commands": { "stage": "./scripts/stage.sh" } }
```

That goes in `commands` of `.factor/factory.json`, beside `verify` and `ship`.

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
- Give the scripted agent in `.factor/local.json` a script for the new lane (`init` wrote one for `plan` and
  `build` under `author`, and for `review` and `test` under the other two roles) and run a task: you see the
  lane's place in the run, its checkpoint and its transitions without spending anything.
- Then bind a real login, and keep the checkpoint at `in` until the lane has a record.
