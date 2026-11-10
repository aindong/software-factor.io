# ADR 0010 (D10): Evals run on a scripted agent unless asked otherwise

## Status

Accepted, 2026-11-10.

## Context

The owner said evals that call a paid API are costly. A one-word real run on the default profile read about 37,000 input tokens (docs/research/agent-clis.md).

## Decision

The eval suite runs on the `fake` agent and costs nothing. Real-agent evals are opt-in, run on subscription logins only, and are capped at 10 lane runs a day. API-key money is never spent without a yes from the owner.

## Consequences

- Every gate and the engine can be proven without a model.
- What ran with real agents and what ran on `fake` is stated in every report.
