# ADR 0002 (D2): JSON for what people edit, SQLite for what the factory records

## Status

Accepted, 2026-11-10.

## Context

The owner asked for no server to install. Shared process must be readable and diffable. Run history must survive a crash and be queried. A public factory that kept its state only in a rate-limited outside board lost track of work (docs/research/prior-art-external.md).

## Decision

In the workspace, `.factor/factory.json` and `.factor/workflows/*.json` are committed and edited by hand or through the interface. `.factor/state.db` (SQLite: tasks, runs, lane sessions, events, gate results, costs, inbox) and `.factor/runs/<id>/` (evidence files) are ignored by git. Accounts and role bindings live in `~/.factor/` on the machine. SQLite comes from Node's built-in `node:sqlite`, checked working on Node 24. SQL is written by hand with small migration files.

## Consequences

- Local SQLite is the record. Outside boards are collectors and mirrors, never the source of truth.
- Single owner, single machine. Several people or machines sharing one factory is a known limit, written in the README.
- No native module to compile at install time.
