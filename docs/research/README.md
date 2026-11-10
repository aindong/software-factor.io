# Research notes

Read on 2026-11-10, before any product code. Each note cites where every section was read, and marks what could
not be confirmed as "Not verified". The decisions these notes led to are in `docs/adr/`.
A source given as `.agent/...` is one of the records of the run that built the factory, which are also kept off
the repository.

| Note | What it covers |
| --- | --- |
| prior-art-own (not in this repository) | The owner's first factory and daily loop: gates, limits, incidents, what was awkward. The note describes private projects and stays on the owner's machine. Its findings are below and in the decision records. |
| [prior-art-external.md](prior-art-external.md) | super-board, Stripe Minions, Ramp Inspect, the AI Hero course, Tiny Software Factories, and other factories that publish numbers |
| [agent-clis.md](agent-clis.md) | How to run Claude Code, Codex and Kimi Code without a terminal UI, where usage and cost appear, MCP servers per run, `npx skills` |
| [workflow-formats.md](workflow-formats.md) | GitHub Actions, n8n, statecharts, Tekton and Argo, and the shape the workflow schema takes from them |

## The ten findings that shape the design

1. **The host judges, on the real diff.** The gates worth copying are small functions over the committed change:
   protected paths, tests not weakened, the suite on a fresh checkout, a test-count floor, and new tests that must
   fail without the change. An agent's report only points at evidence. (prior-art-own)
2. **Every loop needs a cap and a named stop reason.** One ticket in the first factory used about 110M tokens over
   7 attempts because review never converged. "No progress" is a stop reason, and running out of rounds ends in a
   hand-off to a person, not another try. (prior-art-own, prior-art-external)
3. **Most failures were setup, not code.** Leaked environment, leftover dev servers and criteria no browser could
   show cost more than bad patches. A required step that is switched off must fail loudly. (prior-art-own)
4. **Measure work landed, not lanes busy.** One public factory ran 293 cycles with 0 merges while looking active.
   Report merge rate and cost per landed task, per lane. Nobody else publishes both. (prior-art-external)
5. **Claim before you spawn.** Seven workers raced for one task elsewhere because the claim came after a slow CLI
   start. Local SQLite is the record. Outside boards are collectors and mirrors. (prior-art-external)
6. **Agents game visible tests.** Keep gates, evals and lessons where a lane cannot edit them, and put a
   deterministic check beside every model judgement. (both prior-art notes)
7. **A workflow is a flat list of lanes with explicit transitions.** Three fixed outcomes (pass, fail, needs a
   person), conditions as data and never as expression strings, and a required round limit on any transition that
   points backwards. (workflow-formats)
8. **Only roles go in the shared file.** n8n exports leak credential names and has to warn its users. A
   machine-local file binds each role to an account. (workflow-formats)
9. **The three CLIs differ where it matters.** Claude Code reports cost in its final result, Codex reports tokens
   only, and Kimi's output is not verified. Each needs its own way to get MCP servers for one run. Both installed
   CLIs print non-JSON lines on stderr, so the two streams stay apart. (agent-clis)
10. **A real agent run is not cheap even for one word.** The one-word probe on the owner's default Claude profile
    read about 37,000 input tokens, because the profile loads its plugins and skills. Lanes should be able to run
    under a lean profile, and cost per lane must be visible from the first run. (agent-clis)

## What changed in the plan because of this

- Kimi: the Python `kimi-cli` is archived. The adapter targets Kimi Code (`kimi`, profile through `KIMI_CODE_HOME`).
- `claude --bare` is ruled out for factory runs: it skips hooks, so guard hooks would not run.
- Codex cost is computed by the factory from a price table, since the CLI reports tokens only.
