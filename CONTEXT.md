# Context: the words this project uses

One meaning per word, in code, docs, the interface and commit messages. If a word here does not fit what you are
building, change this file first, in the same change.

## The factory and its layout

### Factory

One project's setup for getting work done by agents: its workflows, its accounts and its record of runs. It lives
in the project's `.factor/` folder. Avoid: "pipeline", "system".

### Workflow

The process, written as one JSON file: where tasks come from, the lanes they pass through, and how they move
between lanes. A workflow holds roles, never accounts or secrets, so it can be shared. Avoid: "pipeline", "flow",
"recipe".

### Lane

One step of a workflow. A lane does one kind of work on a task (plan, build, review), usually by running one
agent, and ends with an outcome. Avoid: "stage", "step", "station", "node".

### Collector

The part of a workflow that finds tasks and puts them in the queue: issues with a label, lines in a local file, a
schedule, a query to an MCP server. A collector never does the work. Avoid: "source", "trigger", "intake".

### Transition

The rule that says which lane a task enters next, chosen by the outcome of the lane it is leaving. A transition
that points back to an earlier lane must carry a round limit. Avoid: "edge", "route".

### Outcome

How a lane ended for a task. There are exactly three: `pass`, `fail` and `needsPerson`. Avoid: "status", "result"
(a result is what a gate returns).

### Round

One trip around a loop, for example review then revise. The host counts rounds and stops the loop at its limit.
A retry after a crash is not a round. Avoid: "iteration", "attempt" (an attempt is a whole new run of a task).

### Panel

Several agents doing the same lane at once on the same input, each with its own role, joined into one outcome.
Used for review. Avoid: "swarm", "fan-out" as a noun.

## Work and proof

### Task

One piece of work a collector found: a title, a body, where it came from. Avoid: "ticket", "issue", "job" (those
are what the task was in the place it came from).

### Run

One trip of one task through a workflow, from the first lane to a final hand-off or a stop. A task can have
several runs. Avoid: "execution", "session".

### Gate

A check the host runs on a lane's work after the agent has finished: a command, a test-count floor, a protected
path rule. The agent never runs or grades its own gate. A gate returns a result with evidence. Avoid: "check" on
its own, "validation", "guard" (a guard blocks a tool call while the agent works).

### Guard

A rule enforced while an agent is working, before a tool call happens: no reading secrets, no deleting outside
the worktree, no push to the default branch. Avoid: "gate", "policy".

### Evidence

A stored record that proves a claim: the command that ran, its exit code, its output file, the hash of the tree
it ran on, and for interface work the screenshots or recording. Evidence is made or checked by the host. An
agent's report is not evidence. Avoid: "proof", "log", "artefact".

### Hand-off

The checked document a lane leaves for the next lane or for a person: what was done, links to evidence for each
claim, what is still open, and the risk. The host rejects a hand-off that makes a claim with no evidence. Avoid:
"summary", "report", "handover".

### Checkpoint

The point where a lane meets a person, in one of three modes: `in` (the host waits for approval), `near` (the host
tells the person and goes on), `out` (no notice, audited later). Avoid: "approval gate", "human gate".

### Inbox

The one list of things waiting for a person: approvals, questions and blocked work. Avoid: "notifications",
"queue" (the queue holds tasks).

## Agents and accounts

### Agent

A coding tool the factory starts without its terminal interface to work a lane: Claude Code, Codex, Kimi Code, or
any command that reads a prompt. Avoid: "bot", "model" (a model is what the agent calls).

### Adapter

The small piece of code that knows how to start one kind of agent, read its output and report its usage. Avoid:
"driver", "provider".

### Account

One login for one agent, held as that tool's own profile folder on this machine. The factory never stores the
login itself. Avoid: "credential", "key", "user".

### Role

A name a workflow uses for who works a lane: `author`, `reviewer`. A file on each machine binds every role to an
account, a model and an effort level. Avoid: "persona", "agent" (the agent is the tool).

### Session

The factory's own record of one agent working one lane once: the transcript, the tool calls, the tokens and the
cost. Avoid: "conversation", "run" (a run spans many sessions).

### Memory

What the factory keeps for every lane to read: lessons, decisions and project facts. It belongs to the factory,
not to any agent's own memory. Avoid: "context", "knowledge base".

## Running many things at once

### Worktree

A separate checkout of the repository for one run, so runs never share files.

### Slot

The numbered set of things one run may use while it works, so that parallel runs do not collide: a block of
ports, a database name, a browser session name. Avoid: "environment", "sandbox".

### Workspace

The project a factory works on: one repository with its `.factor/` folder. Avoid: "tenant", "company", "project"
where it could mean a product.

## Growing the factory

### Plugin

A package that adds lane types, collectors, gates, adapters, workflows or themes. A workflow names what it uses
as `namespace/type@major`. Avoid: "extension", "integration", "add-on".

### Lesson

One dated line that changes how future lanes work, learned from an escaped defect or a repeated finding. A lesson
changes only through a reviewed change. Avoid: "rule", "tip".

### Escape

A defect that passed every gate and review and was found later. An escape demotes the lane that let it through
and starts a retro. Avoid: "bug" on its own, "regression".

### Autonomy ladder

The three checkpoint modes seen as steps a lane climbs on its record: in the loop, near the loop, out of the
loop. Avoid: "trust level", "automation level".
