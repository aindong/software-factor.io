# Operations: one table for the interface, the command line and your agent

Everything the interface can do, the command line can do, and so can an agent through an MCP server
(ADR 0008). The three are layers over one table of operations in `src/core/operations.ts`. A test
(`test/acceptance/operations-parity.test.ts`) fails when a layer lacks an operation, and when the interface's
server has a route that belongs to none.

| Operation | It | On the command line | What it does |
| --- | --- | --- | --- |
| `workspace` | reads | `softwarefactor status` | The workspace: its name, its folder, the workflow in use and the workflows it has. |
| `workflow_get` | reads | `softwarefactor check` | Read one workflow as JSON, with the problems the checker finds in it. |
| `workflow_check` | reads | `softwarefactor check` | Check a workflow given as JSON: each problem with its place and its fix. Nothing is written. |
| `workflow_save` | changes | `softwarefactor check` | Save a workflow under its name. It is written only when the checker finds no problem: otherwise the problems come back. |
| `runs_list` | reads | `softwarefactor runs` | The runs: every one that is moving or waiting and the latest ended ones, each with where it is and one sentence about what is happening. |
| `runs_get` | reads | `softwarefactor runs <run>` | One run: each lane it went through with its gates, claims, sessions and hand-off, what waits for a person, and its evidence files. |
| `runs_file` | reads | `softwarefactor runs <run>` | Read one file of a run (a gate's output, a hand-off, attached evidence) by the path the run gives for it. Text comes as text. For a picture or a recording only its type and size come. |
| `runs_diff` | reads | `softwarefactor runs <run> --diff` | What a run changed, from its base commit to its head: every changed file by name, and the diff. |
| `inbox_list` | reads | `softwarefactor inbox` | What waits for a person: approvals and questions, each with its run, its lane and the decisions it takes. |
| `inbox_decide` | changes | `softwarefactor approve <run>`, `softwarefactor reject <run>`, `softwarefactor send-back <run>`, `softwarefactor answer <run>` | Decide on a run that waits: approve, reject, send-back (with a note for the lane) or answer (a question, with the answer as the note). The run then goes on by itself. |
| `accounts_list` | reads | `softwarefactor account list`, `softwarefactor role list` | The agent logins on this machine with their limits and what they have used, and which one works each role of the workflow. Never where a login is kept. |
| `roles_bind` | changes | `softwarefactor role bind` | Say which account works a role of the workflow in this workspace, with a model for each size of lane and an effort if wanted. |
| `costs` | reads | `softwarefactor cost` | Tokens and cost by lane, by task and by account, from the session records, with the whole and how many sessions have no known cost. |
| `plugins_list` | reads | `softwarefactor plugins` | What is built in to assemble a factory from: lane types, gate types, collectors, agents and the workflows that come with this version. |

On the command line a workflow is its file: read it, edit it, and run `softwarefactor check`. That is why the
three workflow operations name `check`.

## How an operation that changes something runs

It runs the command line's own command, in a process of its own. There is one implementation of a decision,
and a run goes on after the interface is closed or the agent that approved it has gone. What the command
prints goes to a file under the factor home (`work/<workspace>/decisions/`), not into the repository.

A decision is answered when its command has ended (`ended`, with `done`, `stopped` or `waiting`), or as soon as
the record shows the decision was taken and the run is going on (`going`). When the command line refuses, the
operation refuses with the same message and the same fix. A run that stops is not a refusal.

## In the interface

`POST /api/op/<name>` with the operation's input as JSON, and the page's token. `422` with `path` and `error`
when the input is not what the operation takes. `409` with `error` and `fix` when the factory refuses. The page
uses this for the inbox, accounts, costs and plugins. A few routes of their own remain for the page's
convenience, such as a run's file sent as bytes: each belongs to an operation in the table.

## For your own agent: the operator MCP server

```sh
softwarefactor mcp --operator --workspace /path/to/your/repository
```

It speaks MCP over stdio and serves every operation as a tool of the same name, with the same description and
input. Give it to your own agent, the one you talk to, so it can show you what waits, read a run's evidence and
bind a role. For Claude Code:

```sh
claude mcp add factor -- softwarefactor mcp --operator --workspace "$PWD"
```

The operator server acts as the person at this machine. Whoever can start it can approve. So:

- It does not start when `FACTOR_RUN_ID` or `FACTOR_LANE` is set, and the guard denies an agent inside a run
  the `softwarefactor` command. An agent inside a lane gets the factor server of its lane (docs/memory.md),
  which has five tools and none of these.
- An agent with a shell can drop a variable. As with the rest of the guard, only a sandbox for the agents
  closes that.
- It has not been tried with a real agent CLI yet, only with the tests' own client.

## Not operations yet

Starting and stopping runs (`softwarefactor run`, `stop`), adding and removing accounts (they need a login
made in a terminal), memory (`softwarefactor memory`), and `init`. They are on the command line only, so the
interface does not have them either.
