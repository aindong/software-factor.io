# Collectors

A collector is where tasks come from. A workflow lists one or more under `collectors`, each with an `id` of its
own, a type (`uses`) and that type's settings (`with`). `softwarefactor collect` asks each of them and queues what
is new. `softwarefactor run` does the same before it starts work.

A collector only reads. It never does the work, and it never changes the place it reads: no issue is closed, no
ticket is moved, the task file is not edited. A task is known by its collector and its key, so the same issue
found again is not queued again.

A collector that cannot collect says why on its own line, and the others go on:

```
collected 1 new task
collector issues: could not collect: To get started with GitHub CLI, please run: gh auth login
```

A route can ask where a task came from (`task.source`, the collector's id) and what labels it carries
(`task.labels`). See `docs/workflow-schema.md`.

`softwarefactor run` takes the oldest queued task. To take another one first, name it by its key or by words of
its title: `softwarefactor run --task "#12"`. The words must fit exactly one queued task.

## A local file: `core/file@1`

A markdown checklist in the repository. An open box is a task, and the indented lines under it are its body. A
ticked box is not collected.

```json
{ "id": "tasks", "uses": "core/file@1", "with": { "path": ".factor/tasks.md" } }
```

## GitHub issues: `core/github-issues@1`

The open issues that carry a label, read with the GitHub CLI (`gh`) and the login it already has. The key is the
issue's number (`#12`), and the issue's labels become the task's labels. The body begins with a line that says
where the words came from (`GitHub issue #12, opened by mona: <address>`), then the issue's text. Without `repo`
it reads the repository the workspace is a clone of. It reads the first 100 open issues with the label, and says
so when there were more.

Anyone who can open an issue can write a task. The label is your approval of the issue as it was when you set it:
the text is read at the next `collect`, and a task that has not started yet takes the issue's newest words. Keep a
checkpoint with a person in the loop on workflows fed from a public repository.

```json
{ "id": "bugs", "uses": "core/github-issues@1", "with": { "label": "factory", "repo": "acme/shop" } }
```

## A schedule: `core/schedule@1`

One task each time a schedule comes round. `cron` is the usual five fields: minute, hour, day of the month, month,
weekday (0 or 7 is Sunday). Each is a number, a range (`1-5`), a list (`1,15`), a step (`*/15`) or `*`. Names of
months and days are not taken. Times are the machine's local time.

```json
{
  "id": "nightly",
  "uses": "core/schedule@1",
  "with": { "cron": "0 3 * * *", "title": "Update the dependencies", "body": "Run the updater and open a change." }
}
```

The factory has no clock of its own running. A time that came while nothing ran is collected once, at the next
`collect` or `run`, and only if it was within the last 31 days. The key is the time the task was due, so missing
three nights queues one task, not three.

## An MCP query: `core/mcp-query@1`

One call of one tool on an MCP server, and a task for each item in its answer. This is how a board with no
collector of its own is read: Jira, an alerting tool, a queue of your own.

```json
{
  "id": "tickets",
  "uses": "core/mcp-query@1",
  "with": { "server": "board", "tool": "search_issues", "args": { "jql": "labels = factory AND status = 'To Do'" } }
}
```

The server is declared in the workflow's `mcp`, and it must be one the factory can start itself:

```json
{ "from": "command", "command": "npx", "args": ["-y", "some-mcp-server@1.4.2"], "env": ["BOARD_TOKEN"] }
```

A workflow can come from someone else, and this command runs on your machine. So a collector does not start a
server until you have allowed it here:

```
$ softwarefactor allow board
The server "board" runs: ["npx","-y","some-mcp-server@1.4.2"] (with your BOARD_TOKEN)
allowed: collectors may start "board" on this machine, until the workflow changes what it runs
This allows the command as written, not the program behind it: pin a version, and read a script it names.
```

The approval is kept in `.factor/local.json`, which is not shared. If the workflow later changes the command, its
arguments or the variables it asks for, collecting stops and asks again.

The server gets only the environment variables listed for it (by name: the value stays on the machine), plus the
few every command gets, such as `PATH` and `HOME`. It has one minute to answer, and it is stopped afterwards,
together with anything it started.

What the approval does not cover: the program behind the command. An unpinned `npx -y some-server` runs whatever
is published tomorrow, and a script in the repository can be changed by a later commit. A launcher that hands the
server to a daemon (`docker run`) leaves it running: the factory stops only what the command itself started. The
approval is a line in a file on your machine, as trusted as the rest of `.factor/local.json`.

The answer must be JSON: a list, or an object that holds one (under `issues`, `items`, `tasks` or `results`, or
its first list). An item becomes a task when it has a key (`key`, `id` or `number`) and a title (`title`,
`summary` or `name`). Its `body` or `description` is the task's body, and `labels` its labels. Jira's shape is
read too: `key`, `fields.summary`, `fields.description` when it is plain text, `fields.labels`. Items with no key
or no title, and an item whose key was already seen in the same answer, are skipped, and the output says how many.
At most 100 items are read from one answer.

## What a collected task is to an agent

A task's words can be anyone's. In a lane's prompt they are quoted and named as found by the collector, not as
instructions from the factory. A title is kept to one line and a body to 60,000 characters. A task that is found
again while it still waits takes its newest title, body and labels; once it has started it keeps its own.

## A plugin's collector

A plugin can add a collector of its own (`docs/plugins.md`). A workflow names it as `<plugin>/<type>@<major>`.
Its command runs in the workspace with the collector's settings and prints the tasks as JSON, read like an MCP
query's answer.

## Not built

- A collector cannot query an MCP server that lives in an agent's profile or is reached by a URL. Collecting says
  so and names the change: declare the server with `"from": "command"`.
- Jira has no collector of its own. It is reached through `core/mcp-query@1` and an MCP server for Jira that a
  command starts. This has been run against a stand-in server that answers in Jira's shape, not against a real Jira.
- A collector never writes back: closing an issue when its task is done is a lane's job, not the collector's.
- A schedule in the hour the clocks skip in spring (02:30 where 02:00 to 03:00 does not exist) is not due that day.
- Nothing shows whether an issue's text was edited after it was labelled.
- An agent's use of `gh` is held to reading and to opening its own pull request by the guard, which reads the
  command's words. It is a guard, not a wall: protect the default branch on GitHub as well.
