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

## A local file: `core/file@1`

A markdown checklist in the repository. An open box is a task, and the indented lines under it are its body. A
ticked box is not collected.

```json
{ "id": "tasks", "uses": "core/file@1", "with": { "path": ".factor/tasks.md" } }
```

## GitHub issues: `core/github-issues@1`

The open issues that carry a label, read with the GitHub CLI (`gh`) and the login it already has. The key is the
issue's number (`#12`), the body is the issue's text, and the issue's labels become the task's labels. Without
`repo` it reads the repository the workspace is a clone of. It reads the first 100 open issues with the label.

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
{ "from": "command", "command": "npx", "args": ["-y", "some-mcp-server"], "env": ["BOARD_TOKEN"] }
```

The server gets only the environment variables listed for it (by name: the value stays on the machine), plus the
few every command gets, such as `PATH` and `HOME`. It has one minute to answer.

The answer must be JSON: a list, or an object that holds one (under `issues`, `items`, `tasks` or `results`, or
its first list). An item becomes a task when it has a key (`key`, `id` or `number`) and a title (`title`,
`summary` or `name`). Its `body` or `description` is the task's body, and `labels` its labels. Jira's shape is
read too: `key`, `fields.summary`, `fields.description` when it is plain text, `fields.labels`. Items with no key
or no title are skipped, and the output says how many.

## Not built

- A collector cannot query an MCP server that lives in an agent's profile or is reached by a URL. Collecting says
  so and names the change: declare the server with `"from": "command"`.
- Jira has no collector of its own. It is reached through `core/mcp-query@1` and an MCP server for Jira that a
  command starts. This has been run against a stand-in server that answers in Jira's shape, not against a real Jira.
- Collectors from plugins: a workflow may name one, and collecting says that it is not on this machine.
- A collector never writes back: closing an issue when its task is done is a lane's job, not the collector's.
