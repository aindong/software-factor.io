# Contributing

Thank you for looking. This is version 0.0.0: the shape still moves, so open an issue before a large change.

## Set up

You need Node 24 or newer, git and pnpm.

```sh
pnpm install
pnpm run typecheck && pnpm run lint && pnpm run build && pnpm test
node dist/cli.js eval
```

The tests start no real agent and need no network. CI runs the same commands on macOS and Linux.

## How a change is made here

- **A test first.** Write the test that fails without your change, and commit it before the change. A bug fix
  comes with the test that shows the bug.
- **Small commits that say what changed**, in a plain sentence: `Costs: money is shown in cents`.
- **Files stay small.** No source file over 20 KB: split it.
- **What a person sees is checked in a browser.** The checks in `test/ui/` drive the interface by keyboard with
  `playwright-cli`. Add a step there for a change to the interface.
- **The README stays honest.** Its section on what has run with real agents, and what has not, is held by a
  test. If your change makes a line there untrue, change the line.
- **Shell scripts run on macOS's own tools and on Linux.** No GNU-only flags.

## Where things are

- `src/core/`: the engine, the gates, the agent adapters, the command line. `src/ui/`: the interface.
- `workflows/`: the workflows that ship. `schema/`: the format of a workflow file.
- `docs/`: one guide per subject, and the decisions with their reasons in `docs/adr/`.
  [CONTEXT.md](CONTEXT.md) defines the words. [DESIGN.md](DESIGN.md) is the interface's design system.

## Useful to send

- A lane, gate or collector type as a plugin: see [write a plugin](docs/plugins.md).
- A run on a real agent that the README lists as not yet run, with what happened.
- A workflow of your own that others could use.

## Security

An agent held only by the guard can do what your user can do: see the limits at the end of
[accounts, roles and the guard](docs/accounts.md). If you find a way past the guard or a gate, open an issue
without the working steps and say you have them.

By contributing you agree that your work is under the project's [MIT licence](LICENSE).
