# Plan check: a failing message ends with an example of a valid `Verification contract`

## Goal

GitHub issue #9. When `core/plan-contract@1` fails, its message lists the problems. An agent that repairs the
plan still has to work out the form from those sentences. The failing message now ends with a short example of
a valid `Verification contract` section, three lines at most. A passing message is unchanged.

## Choices (the issue left these open)

- **What "three lines" counts.** The example is exactly three lines: the heading and two contract lines. A lead-in
  sentence ("A valid ... looks like this:") stands on its own line before them and is not part of the example.
- **The example.**
  ```
  ## Verification contract
  - 1: test:test/unit/example.test.ts
  - 2: cmd:pnpm test
  ```
  It shows the heading, the form `- <n>: <kind>:<what>`, and two of the four kinds.
- **For every failing plan**, whatever the problem (a missing file, a missing heading, a bad line). One rule, no
  case by case choice of when it helps.
- **Where it lives.** The message is built in a new exported function `planMessage(problems, planPath)` in
  `src/core/gates/plan-contract.ts`, which `planContractGate` calls. The unit test reaches the message without a
  `GateJob`, a checkout or an evidence file. The gate's verdict and the `record` call do not change.
- **Not done:** an example for the `Acceptance criteria` section (not asked), a longer form guide, a change to
  the problem sentences.

## Acceptance criteria

1. The message of a failing plan ends with the heading `## Verification contract` followed by two lines of the
   form `- <n>: <kind>:<what>` with a kind of `test`, `cmd`, `ui` or `human`: three lines at most, and the line
   before them is not part of the example.
2. The example is there for a plan with no `Verification contract` heading as well as for a plan with a bad line.
3. The message of a passing plan is exactly as before and holds no example.
4. `pnpm typecheck`, `pnpm lint` and `pnpm test` pass.

## Verification contract

- 1: test:test/unit/plan-contract-example.test.ts
- 2: test:test/unit/plan-contract-example.test.ts
- 3: test:test/unit/plan-contract-example.test.ts
- 4: cmd:pnpm typecheck && pnpm lint && pnpm test

## Files to touch

- `src/core/gates/plan-contract.ts`: `PLAN_EXAMPLE`, `planMessage`, and the gate uses it.
- `test/unit/plan-contract-example.test.ts`: written at planning.

## Approach

1. Tests first (done at planning). They fail now because `planMessage` is not exported from the module.
2. Add `planMessage`; in the gate replace the inline `text` with `planMessage(problems, planPath)`.
3. Run the new test, then typecheck, lint and the whole suite.

## Risks / out-of-scope

- `test/unit/plan-contract.test.ts` calls only `planProblems` and is not touched. The eval case at
  `src/core/eval/cases.ts:132` checks that a bad plan is caught; check in step 3 that it does not match the old
  message text exactly.
