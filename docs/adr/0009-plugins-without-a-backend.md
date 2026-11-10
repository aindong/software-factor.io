# ADR 0009 (D9): Plugins install from git or npm, with a static directory

## Status

Accepted, 2026-11-10.

## Context

The owner wants a directory of plugins that installs as easily as `npx skills`. A hosted registry would be a service to run and secure.

## Decision

A plugin is a git repository or npm package with a `factor-plugin.json` manifest that adds lane types, collectors, gates, adapters, workflows or themes. A workflow names what it uses as `namespace/type@major`, with `core` reserved. A lock file beside the workflow pins exact versions and hashes. `softwarefactor add owner/repo` installs one. The directory is a static JSON index in a GitHub repository. Skills install through `npx skills add` into the worktree.

## Consequences

- Plugin code is untrusted: the factory shows what it will run and asks once before first use.
- A lane keeps the major version it was saved with.
- No server to run for the directory.
