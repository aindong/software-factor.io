# ADR 0004 (D4): Run on the host first, with guards that fail closed

## Status

Accepted, 2026-11-10.

## Context

The first factory began with every step in a locked container and later added host mode because the container made agents slow and weak. Its first host runs then failed mostly on setup: leaked environment, leftover dev servers (the owner's notes on that factory, which are not in this repository). A public factory's guard hooks fail open on their own errors (docs/research/prior-art-external.md).

## Decision

Lanes run on this machine in a worktree, with the owner's CLIs, guarded by rules checked before each tool call: no reading or printing secrets, no deletes outside the worktree, no push to the default branch. A guard that errors blocks the call. Where a CLI cannot run guards, the lane says so in its session record and the workflow validator warns. A container runner is a later plugin and a property of a lane, not the default.

## Consequences

- A local run is not a sandbox, and the README says so.
- Guards are one wall of two: gates on the host are the other.
- Each run cleans up what it started (processes, ports, databases) through its slot.
