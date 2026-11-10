# ADR 0003 (D3): Agents are the CLIs already installed, behind adapters

## Status

Accepted, 2026-11-10.

## Context

The owner has three Claude profiles and a Codex login, each with its own skills, plugins and MCP servers. The first factory's sandboxed agents were slow and weak because they lacked that setup. Each CLI reports usage differently (docs/research/agent-clis.md).

## Decision

An adapter starts one vendor CLI without its terminal interface, in the run's worktree, under one profile folder: `CLAUDE_CONFIG_DIR` for Claude Code, `CODEX_HOME` for Codex, `KIMI_CODE_HOME` for Kimi Code. The factory never stores a vendor login. Adapters ship for Claude Code (`claude -p --output-format stream-json --verbose`), Codex (`codex exec --json`), Kimi Code (`kimi -p --output-format stream-json`), a `command` adapter for anything that reads a prompt, and a scripted `fake` agent for tests. Each adapter closes stdin and reads stdout and stderr as two separate streams.

## Consequences

- Lanes get the owner's real tools with no setup.
- `claude --bare` is never used: it skips hooks, so guards would not run.
- Codex reports tokens only, so the factory computes its cost from a price table.
- Kimi Code's output shape is not verified until it is installed. Its adapter is tested against a stand-in binary.
- A profile that loads many plugins is expensive per run (about 37,000 input tokens for a one-word reply), so a lane may name a leaner profile.
