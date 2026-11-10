# ADR 0007 (D7): The factory owns memory and sessions

## Status

Accepted, 2026-11-10.

## Context

Each vendor's CLI keeps its own memory and session history, so a Codex lane cannot see what a Claude lane learned. The owner had to repeat things agents had already been told.

## Decision

The factory records every lane's transcript and usage from the CLI's output. Memory (lessons, decisions, project facts) is plain files with an index in SQLite. It is added to each lane's prompt and offered to every agent through one `factor` MCP server with a small set of tools: read memory, write a hand-off, ask a question, attach evidence.

## Consequences

- Agents from different vendors work together through the same server.
- Lessons change only through a reviewed change. No lane edits them during a run.
- Each CLI needs its own way to receive the server for one run (docs/research/agent-clis.md).
