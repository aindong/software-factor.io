# Product

<!-- impeccable:product-schema 1 -->

How this file was made: the owner set a goal run that says "decide without me", so there was no interview.
Every fact below comes from the owner's written brief (2026-11-10), from what they said in the same conversation,
or from a count of their 255 past coding sessions (`.agent/operator-profile.md`). Lines marked (inferred) are
readings of that evidence, not the owner's words, and should be corrected by them.

## Platform

web

## Stack

React with Vite, built to static files and served by Hono from the `softwarefactor` command on the developer's own
machine. The lane diagram is plain SVG, laid out by the tool's own code (React Flow was the first plan, and
was dropped in task 14: a workflow file holds no positions). Hand-written CSS on design tokens, no component kit.
Chosen with the owner on 2026-11-10 (they asked "which stack", then confirmed React and Hono).

## Users

Developers who already run coding agents every day and have become the bottleneck: they prompt, wait, check and
approve, one step at a time. The owner is the first user: a senior developer working across several client
codebases with three Claude profiles and a Codex login.

They reach the interface at their desk, with a terminal and an editor open, in three states of mind:

- Setting up: laying out their own process for a repository, unhurried, wanting to understand every piece.
- Glancing: between other work, wanting to know in two seconds whether anything needs them.
- Deciding: one approval or question in front of them, wanting the proof before they say yes. Most of the owner's
  past prompts are one word: merge, go, ship it, approve.

(inferred) Later users are other developers and small teams who are handed a workflow file and want to run and
adapt it without reading the source.

## Product Purpose

Software Factor.io is a software factory the developer assembles. They lay out lanes: where tasks come from, which
agent and account works each lane, which checks gate it, where a person approves. Agents do the work. The factory
checks it on the host and keeps the evidence. The developer moves out of the loop lane by lane, as each lane's
record earns it.

Success: the developer trusts a finished task without re-doing the agent's checking, can change the process
without touching code, and spends their attention only where a decision needs them.

## Positioning

- The process is data: one JSON file with no secrets, which can be read, edited by hand, and shared.
- Nothing is done on an agent's word. Every claim links to evidence the host made or checked.
- Autonomy is earned per lane from its record, never switched on.
- It uses the agent CLIs the developer already has, with their own logins, and stores none of them.

## Operating Context

A local tool, opened in a browser tab beside the terminal. The developer's material: repositories, worktrees,
branches and commits, pull requests, test output with exit codes, diffs, screenshots taken before and after,
recordings, token counts and cost. Tasks arrive from issue trackers, a local file, a schedule or a monitoring
alert. Several runs happen at once. Keyboard use is heavy.

The vocabulary is fixed in `CONTEXT.md`: factory, workflow, lane, collector, gate, guard, evidence, hand-off,
checkpoint, inbox, run, round, slot.

## Capabilities and Constraints

- Built so far: the workflow file format and its checker, the engine, and the first screen: the factory floor.
- Planned screens: the factory floor (build and edit a workflow by placing and wiring lanes, with the JSON one
  click away), live runs with an evidence viewer, the inbox for approvals and questions, accounts, plugins, costs.
- Everything the interface can do, the command line and the MCP server can also do.
- Single owner, single machine. No sign-in, no hosted service.
- No real run data exists until the engine is built. Until then any data on a screen is sample data and must say so.
- Undecided: the final domain (factor.io or softwarefactor.io). Whether there will be a public site.

## Brand Commitments

- Name: Software Factor.io. Command: `softwarefactor`.
- The owner's words for the look: "really good looking", "not just a generic ui/ux style", "innovative looking
  technical style".
- The owner's words for the substance: "I dont want to build around the hype only, I want to have something that
  is really usable."
- The idea comes from factory-building games: belts, machines, items moving through. The product must not use any
  game's name, art or assets.
- Recorded in the plan and accepted by the owner: no purple gradients, no stock grid of cards.
- (inferred) Voice: plain, short sentences, no hype words. The owner wants plain, short sentences with no hype
  words in everything written for them.

## Evidence on Hand

- Real: the three example workflows in `workflows/`, the research notes in `docs/research/`, and counts from the
  owner's own sessions.
- Absent, and not to be invented: customers, testimonials, benchmarks, pricing, user numbers, logos.

## Product Principles

1. Evidence before trust. A claim without proof is shown as unproven, never as done.
2. The process belongs to the developer. Show it, let them reshape it, never hide it in code.
3. Quiet until it needs you. The interface earns attention only for a decision.
4. Say what it cost. Time, tokens and money are on every run.
5. Honest about limits. What ran for real and what did not is always stated.

## Accessibility & Inclusion

Every action reachable by keyboard, with a visible focus. Text contrast at WCAG AA in light and dark. Motion
respects the reduced-motion setting, and state is never carried by colour alone.
