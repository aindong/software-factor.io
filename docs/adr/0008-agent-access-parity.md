# ADR 0008 (D8): Everything the interface can do, the command line and the MCP server can do

## Status

Accepted, 2026-11-10.

## Context

The Tiny Software Factories videos argue for agent access parity: every button a person can press, an agent can press too (.agent/sources/tiny-software-factories.md). A factory that only a person can reconfigure cannot improve itself.

## Decision

One core library holds every operation. The interface, the CLI and the MCP server are thin layers over it, and none has an operation the others lack. The interface is a view over the same files and database.

## Consequences

- A test lists the core operations and fails when one is missing from a layer.
- Parity stops at gates, lessons, prompts and evals inside a run: an agent cannot change what grades it.
