# Sharing a workflow

A workflow leaves a workspace as one JSON file and arrives in another. The file holds the workflow and what it
needs by name. It holds nothing of the machine it came from.

## Export

```
$ softwarefactor export > my-flow.json
$ softwarefactor export bugfix-fast --out bugfix-fast.json
```

With no name it exports the workspace's active workflow. What it writes:

```json
{
  "softwarefactorExport": 1,
  "workflow": {
    "$schema": "https://softwarefactor.io/schema/workflow/v1.json",
    "version": 1,
    "name": "small-fix",
    "description": "One agent does the task, the project's checks judge it, a person approves.",
    "roles": { "author": { "description": "Does the task and commits it." } },
    "limits": { "minutes": 30, "tokens": 500000 },
    "commands": { "verify": { "description": "The project's own checks: tests, types, lint." } },
    "collectors": [{ "id": "tasks", "uses": "core/file@1", "with": { "path": ".factor/tasks.md" } }],
    "gates": { "verify": { "uses": "core/command@1", "with": { "command": "verify" }, "onFail": "fail" } },
    "lanes": [
      {
        "id": "work",
        "uses": "core/agent@1",
        "agent": { "role": "author", "access": "write", "prompt": "Do the task below and commit your work." },
        "gates": ["verify"],
        "checkpoint": "in",
        "on": { "pass": "@done", "fail": "@stop" }
      }
    ]
  }
}
```

- A prompt that the workflow keeps in a file beside it is put into the document as text: one file travels.
- For each plugin the workflow lists, the document carries its pin from `.factor/plugins.lock.json` under
  `plugins`: version, source, commit and the sha256 of its files.

An export is refused, with the place named, when:

- the workflow does not pass `softwarefactor check` (a secret anywhere in it, a prompt file included, is one
  such problem),
- a role has the name of an account on this machine (a shared workflow names roles, never accounts),
- a text in it holds the path of your home folder, the workspace or the factory's folder,
- a plugin it lists is not installed here, or was added from a folder on this machine: the other machine could
  not fetch it.

Read an export before you send it. No scan finds a person or a company named in the words of a prompt, and
some names do travel because the workflow needs them: the repository a collector reads, the source of a skill
or a plugin, the address or the command of an MCP server.

## Import

```
$ softwarefactor import my-flow.json
```

This writes nothing. It shows the workflow: its lanes with their checkpoints and whether they can change files,
where its tasks come from, how many prompts it holds, every command line it would run on your machine (lanes,
gates, waits, MCP servers), and what it needs before it can run. It ends with the command that imports exactly
the file that was shown:

```
Nothing was written. To import it: softwarefactor import my-flow.json --yes --hash <sha256 of the file>
```

With `--hash`, the import is refused if the file has changed since you read the listing. `--yes` alone imports
the file as it is now, after printing the same listing.

What `--yes` does:

- writes the workflow to `.factor/workflows/<name>.json`. A workflow of that name that is already there is never
  written over: the import stops and says so.
- sets every lane that did not wait for a person to checkpoint `in`. The record that let a lane run unwatched
  belongs to the other machine. A lane's `pin` is kept. `--keep-checkpoints` leaves the checkpoints as they
  are, and the listing then names the lanes that will run without a person.
- adds the plugins' pins to `.factor/plugins.lock.json`, so `softwarefactor add` installs exactly those versions.
  A pin is taken only for a plugin the workflow lists, from a repository, at a commit. If the workspace already
  pins another version, the import stops and changes nothing.
- with `--use`, makes it the workspace's active workflow. Without it, the active workflow stays as it is.

An import allows nothing. On your machine you still:

- bind each role: `softwarefactor role bind <role> --account <name>`,
- define each workspace command under `"commands"` in `.factor/factory.json` (the export says what each must do,
  not how your project does it). If your workspace already defines a command of that name, the listing shows what
  it runs here: the imported workflow's gates will run it,
- see and install each plugin: `softwarefactor add`,
- see and allow each MCP server a collector starts and each skill from a repository: `softwarefactor allow`.

`softwarefactor run` refuses to start until these are done, and says which is missing.

One thing to read with care: a gate's command runs on your machine before anyone is asked, also for a lane that
waits for a person, because the person approves the work after its gates have passed. The listing shows every
such command.

## What an export does not carry

- Any account, role binding or model, or anything else in `.factor/local.json`.
- The shell lines of the workspace's commands and the `gateEnv` names in `.factor/factory.json`.
- Any approval: of a plugin, of an MCP server, of a skill.
- Any lesson or memory, and no runs, evidence or costs.
- The plugins' files: only their pins.
