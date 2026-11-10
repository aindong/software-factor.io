# ADR 0006 (D6): Evidence is a stored object, not a sentence

## Status

Accepted, 2026-11-10.

## Context

The owner's most repeated correction is a request for proof: did you test this, show me before and after. The first factory once shipped an interface change nobody had seen, because the step that looked was silently off (docs/research/prior-art-own.md).

## Decision

Every gate result stores the command, its exit code, the output file with its hash, and the hash of the tree it ran on. Interface work adds screenshots or a recording made by the host. A hand-off lists claims, and each claim links to evidence. The schema rejects a claim with no evidence before any model reads it. Missing, unreadable or stale evidence is a hold for a person, never a pass. A push after review voids the evidence for that review.

## Consequences

- Evidence made by an agent counts only when the host can check it.
- The interface can show, for any task, what was claimed and what proves it.
- A result is reused only for the exact tree it was made on.
