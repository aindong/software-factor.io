# ADR 0005 (D5): The host judges, the agent works

## Status

Accepted, 2026-11-10.

## Context

Agents game visible tests, and an agent's own report of success is not reliable. The gates that held in the first factory were small functions over the committed diff (the owner's notes on that factory, which are not in this repository). Other factories keep the builder and the reviewer apart (docs/research/prior-art-external.md).

## Decision

Gates run by the factory on a fresh checkout of the committed change, never inside the agent's session. A lane cannot mark itself passed. An author lane never reviews its own change. Each gate is data: a name, a check, whether a failure is fatal or goes back for repair, and whether it blocks or only informs. A workflow whose gates have no commands does not start. A required step that is switched off fails loudly.

## Consequences

- First gates to build: protected paths, tests not weakened, the suite on a fresh checkout, the test-count floor, new tests fail without the change.
- Cheap gates run before costly ones.
- A deterministic check sits beside every model judgement.
