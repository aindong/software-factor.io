# Plugins

A plugin adds things a workflow can use: collectors, gates, lane types and workflows. It is a folder, or a git
repository that holds one, with a file named `factor-plugin.json`. There is no service behind it and no account
to make.

## Add one

```
$ softwarefactor add ./my-plugin
$ softwarefactor add acme/factor-board
$ softwarefactor add acme/tools/plugins/board#v2
$ softwarefactor add sample
```

A source is a folder (it begins with `.`, `/` or `~`), a repository on GitHub as `owner/repo` (with a folder
inside it, and `#` and a branch or tag, if wanted), or a name from the directory.

`softwarefactor add` never installs at once. It first shows what the plugin holds: its name and version, where
it was read from and at which commit, every type it adds, and every command line it would run, the commands of
the workflows it brings included. It ends with the command that installs exactly what was shown:

```
Nothing was installed. To install it: softwarefactor add acme/factor-board --yes --hash 3fa9c1d2e4b7
```

With `--hash`, the install is refused if the source has changed since you read the summary. `--yes` alone
installs what the source gives now, after printing the same summary.

What `--yes` does:

- copies the plugin's files into the factory's own folder on your machine (`~/.factor/plugins/<name>/<hash>/`),
- records in `.factor/local.json` (yours, not shared) that you allowed those files in this workspace,
- pins the plugin in `.factor/plugins.lock.json` (shared, beside the workflows): name, version, source, the
  sha256 of its files, and the commit for a git source,
- copies each workflow it brings into `.factor/workflows/`, unless a file of that name is already there.

`softwarefactor plugins` lists what is installed here with what each adds. `softwarefactor plugins --available`
lists the directory.

## On another machine

The lock travels with the repository. On a machine that has the repository and not the plugins:

```
$ softwarefactor add          # shows every plugin the lock pins
$ softwarefactor add --yes    # installs them
```

Each is fetched from its source, at the pinned commit for a git source, and refused if its files are not the
ones the lock pins.

## What keeps a plugin honest

A plugin's commands run on your machine with your rights, like a command lane's. The safeguards are these:

- You see every command before anything is installed, and nothing of the plugin runs during `add`.
- A plugin is used only when three things agree: the files installed on this machine, the hash you allowed in
  this workspace, and the hash the lock pins. If a file changes, or a pull brings a lock that pins something
  you have not seen, `collect` and `run` refuse with the command that shows the plugin again.
- A plugin holds plain files only: a link is refused. It holds at most 500 files and 5 MB.
- An agent in a lane is denied the `softwarefactor` command, and with it `add` and `allow`.
- A run does not start if its workflow uses a plugin that is not installed, allowed and pinned here.

What the hash does not cover: a program the plugin's command calls from outside its own folder (an `npx`
package, a tool on your PATH). Read the commands with that in mind.

## Use it in a workflow

A workflow lists the plugin with the major version it was written for, and names its types as
`<plugin>/<type>@<major>`:

```json
{
  "plugins": { "sample": "^1.0.0" },
  "collectors": [{ "id": "notes", "uses": "sample/inbox@1", "with": { "folder": "inbox" } }],
  "gates": { "leftovers": { "uses": "sample/no-word@1", "with": { "word": "FIXME" }, "onFail": "fail" } }
}
```

A workflow that asks for another major version than the one installed is refused, with both named.

## Write one

```json
{
  "name": "board",
  "version": "1.0.0",
  "description": "Tasks from our board, and a gate that checks the changelog.",
  "collectors": {
    "open@1": { "description": "Open items of the board.", "run": "node \"$FACTOR_PLUGIN_DIR/open.mjs\"" }
  },
  "gates": {
    "changelog@1": { "description": "The change has a changelog line.", "run": "sh \"$FACTOR_PLUGIN_DIR/changelog.sh\"" }
  },
  "lanes": {
    "announce@1": { "description": "Posts the result to the team channel.", "run": "node \"$FACTOR_PLUGIN_DIR/announce.mjs\"" }
  },
  "workflows": ["workflows/board-flow.json"]
}
```

- `name` is the plugin's name in a workflow: lowercase letters, digits and dashes. `core` is the factory's own.
- `version` is three numbers. A type's key ends in `@` and its major version.
- `run` is a shell command line. It gets two variables: `FACTOR_PLUGIN_DIR`, the plugin's installed folder, and
  `FACTOR_WITH`, the `with` settings of the collector, gate or lane as JSON. The settings are passed as they
  are: the plugin checks them itself.
- A **collector** runs in the workspace and prints the tasks it found as JSON: a list of items with a `key`
  (or `id`), a `title`, and if wanted a `body` and `labels`. It has one minute, and it must only read.
- A **gate** runs in a fresh checkout of the commit the lane left, like a command gate. Exit 0 passes. What it
  prints is kept as the gate's evidence. It also gets `FACTOR_BASE`, the commit the run started from, and
  `FACTOR_HEAD`, the commit it checks.
- A **lane type** runs in the run's worktree, like a command lane. Exit 0 passes the lane.
- A **workflow** it brings must pass `softwarefactor check` as it is.

`plugins/sample` in this repository is a small plugin with one of each, to read and copy.

## The directory

The directory is one JSON file: `directory/index.json` in the factory's repository. Each entry is a name, a
description and a source. `softwarefactor add <name>` looks the name up and adds that source, and refuses if
the plugin it finds there has another name. To use an index of your own, set `FACTOR_DIRECTORY` to a file or an
address. To be listed, open a pull request that adds a line.

## Skills

A skill is not a plugin: it is instructions for an agent. A workflow names the skills its lanes use, and the
ones that come from a repository are installed into each run's worktree with `npx skills`:

```json
{
  "skills": { "review": { "from": "repo", "source": "acme/skills", "skill": "code-review" } }
}
```

A lane's agent names it with `"skills": ["review"]`. Because a skill is someone else's text put before your
agent, and fetched over the network, you allow each one on your machine first:

```
$ softwarefactor allow --skill review
```

When a run starts, the factory runs `npx skills add acme/skills -s code-review -a <agent> -y --copy` (version
1.7.6 of `skills`) in the run's worktree, once for each agent that works a lane naming the skill. The folders
it creates are kept out of the run's change (they are added to the repository's `.git/info/exclude`). If the
workflow later names another source for the skill, you are asked again. The approval is of the source as named,
not of what it holds tomorrow.

## Not built

- A plugin from an npm package. Sources are folders and git repositories.
- Agent adapters and themes from a plugin. A plugin adds collectors, gates, lane types and workflows.
- A hosted registry, with search, ratings or accounts. The directory is a file.
- A schema for a type's settings. `with` is passed to the plugin as it is.
- Removing a plugin with a command: take its line out of `.factor/plugins.lock.json` and `.factor/local.json`.
