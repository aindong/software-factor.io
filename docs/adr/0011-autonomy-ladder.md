# ADR 0011 (D11): People leave the loop lane by lane, on the lane's record

## Status

Accepted, 2026-11-10.

## Context

The owner's prompts are mostly approvals: merge, go, ship it. The goal is to move them out of the loop without losing quality. Removing review by default is what other factories warn against (docs/research/prior-art-external.md).

## Decision

Each lane has a checkpoint mode: `in` (the host waits for approval), `near` (the host tells the person and goes on), `out` (no notice, audited later). New lanes start at `in`. The factory suggests a promotion after 10 runs in a row approved without edits and with no escape. An escape or an approval that needed an edit demotes the lane one step and opens a retro. One-way doors (data deletion, a public API change, a message sent, a production deploy) never go past `in`.

## Consequences

- The record that drives the ladder is the same one the interface shows.
- A reviewer's veto rate per lane is ladder input.
- The person who wrote a prompt may not approve the change it produced.
