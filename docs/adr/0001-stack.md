# ADR 0001 (D1): TypeScript on Node, one package, one command

## Status

Accepted, 2026-11-10.

## Context

The owner works in TypeScript with pnpm, and people install agent tooling with `npx`. The first factory was one 520 KB Python file next to a separate web app, so engine and interface could not share types (the owner's notes on that factory, which are not in this repository).

## Decision

TypeScript on Node 24 with pnpm, in one repository and one npm package. One command, `softwarefactor`, runs the engine, the CLI and the interface server. Hono serves the API and the built interface, with server-sent events for live updates. The interface is React with Vite, React Flow for the lane canvas, and hand-written CSS on design tokens. Zod is the one source for types, validation and the published JSON Schema. Tests run on Vitest, with Biome and `tsc` in the gate.

## Consequences

- One language from schema to screen, so a workflow type is defined once.
- `factor` is not used as the command name: it is a GNU coreutils command on Linux.
- Left out on purpose: Next.js, Electron, Docker, Postgres, an ORM and a job queue service. Add one only when a task proves the need.
- No file grows past 20 KB, which keeps the engine from becoming one large file again.
