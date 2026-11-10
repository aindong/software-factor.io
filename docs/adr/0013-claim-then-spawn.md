# ADR 0013 (D13): Claim before spawning, and count work landed

## Status

Accepted, 2026-11-10.

## Context

A public factory had seven workers race for one task because the claim came after a slow CLI start, and ran 293 cycles with 0 merges while looking busy (docs/research/prior-art-external.md). The first factory's worst ticket never converged (docs/research/prior-art-own.md).

## Decision

A run claims its task in SQLite before any process starts, and keeps a process id and a heartbeat so orphans are found at start. Progress means work landed, not lanes busy. Every loop has a round limit and a named stop reason, with `no progress` (the same findings twice) among them. Running out of rounds ends in a hand-off to a person with what is still open. A run halts when it spends its budget without progress.

## Consequences

- Stop reasons are data on the run, so they can be counted.
- The factory reports merge rate and cost per landed task, per lane.
- A crash is told apart from a failure and from a stall.
