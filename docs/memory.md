# Memory and the factor server

Each vendor's CLI keeps its own memory, so a lane on Codex cannot see what a lane on Claude Code learned. The
factory keeps the memory itself and gives it to every agent, whichever CLI it runs on.

## What the project remembers

Memory is markdown files under `.factor/memory/`, in any folders you like (`lessons/`, `decisions/`, `facts/`).
The first `# heading` is the title. They are committed, so a change to the project's memory is reviewed like any
other change.

Every lane's prompt holds the memory under the heading "What this project remembers". Up to about 8,000
characters go in whole. Past that the prompt lists titles only, and the agent reads an entry with the
`memory_read` tool.

The files are read from your repository, not from the run's worktree. An agent that writes
`.factor/memory/` in its worktree changes nothing a lane sees, and a lane with the `protected-paths` gate fails
on that commit.

## Notes from one lane to the next

An agent can leave a note for the lanes after it: a fact it found that they would otherwise find again, such
as "the tests need NODE_ENV=test". A note is the agent's words, so it is treated as such:

- It is shown to later lanes of the same run only, quoted line by line under a heading that says agents wrote
  it. A run of another task does not see it.
- It becomes part of the project's memory only when a person keeps it:

```sh
softwarefactor memory list        # what is kept, and what agents have proposed
softwarefactor memory keep 12     # writes .factor/memory/notes/<title>.md: read it over, then commit it
softwarefactor memory drop 13     # never shown again
```

A kept note says in its last line which run, lane and account wrote it. No agent can keep a note: the server
has no tool for it.

Every time a lane is given an entry through `memory_read`, the factory records which lane, on which account,
read which entry (table `memory_reads`). That is how a run can show that a Codex lane read what a Claude lane
wrote.

## The factor server

`softwarefactor mcp` is a small MCP server over stdio. The factory gives it to the agent's CLI for one lane.
Which run and lane it serves is fixed on its command line, so a tool call cannot claim to be another lane.

| Tool | What it does |
| --- | --- |
| `memory_read` | The project's memory and this run's notes, all of it or the entries with a word (`query`). |
| `memory_note` | Leave a note for later lanes: a title and a body of at most 4,000 characters, 20 notes a lane. |
| `handoff_write` | Hand off without writing a file. The host checks the hand-off exactly as it checks the file. |
| `ask_question` | Ask a person. The run waits, and the lane starts again with the answer. |
| `evidence_attach` | Attach a text file of at most 1 MB that a claim can cite as `attached:<name>`. |

How each CLI gets it:

- Claude Code: `--mcp-config` with this one server and `--strict-mcp-config`, so it is the only MCP server of
  the run. Its tools need no approval, and the guard allows them and no other MCP tool.
- Codex: `-c mcp_servers.factor.command=...` and `-c mcp_servers.factor.args=[...]`.
- Kimi Code and command accounts get the memory and the notes in the prompt only.

The server is written by hand, about 150 lines, because its five tools need only `initialize`, `tools/list`
and `tools/call`. It has been tested with stand-in clients, not yet with the real CLIs.

Operator tools through the server (status, inbox, approve) are not built yet. They come with the interface.
