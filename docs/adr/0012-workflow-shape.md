# ADR 0012 (D12): A workflow is a flat list of lanes with explicit, bounded transitions

## Status

Accepted, 2026-11-10.

## Context

The process must be data that reads well by hand and suits a visual editor. GitHub Actions hides logic in expression strings and cannot loop. n8n keys edges by display name and leaks credential names in exports (docs/research/workflow-formats.md).

## Decision

A workflow has a flat `lanes` array. Each lane has a stable `id`, a `uses` type, and an `on` map keyed by the three outcomes `pass`, `fail` and `needsPerson`. Conditions are data, never expression strings. A transition that points back to an earlier lane must carry `maxRounds` and be followed by a default for when rounds run out. `retry` covers crashes and does not use up a round. A panel is a property of a lane. Only roles appear in the file. A `$schema` URL and an integer `version` are required, and unknown keys are rejected.

## Consequences

- The validator rejects a cycle with no bound and a lane with no way out.
- Limits are written out, with no hidden defaults that matter.
- Canvas positions and run data stay out of the shared file.
