# Accounts: choose a model from a list, with its version, and widen the selects

GitHub issue #10.

## Goal

On the Accounts page, under "Who works each role", the model of each tier (small, medium, large) is chosen from a
list of the bound account's agent, each entry with its version ("Sonnet 5.5 (claude-sonnet-5-5)"), made from the
models `src/core/prices.ts` knows, newest first, and from what this account has run here. The list also has "the
CLI's own" and "Another model" (a text field). A bound model the list does not know is shown and kept. An alias says
which version it last ran as. Changing the account to another agent changes the list and clears the other agent's
models with a word. The Account, Effort and model selects are as wide as their longest option and look like the
other fields, in both themes, at 1440 and 390. `softwarefactor role list` prints the model of each tier.

## Choices (the task left these open)

- **One pure module, `src/core/models.ts`**, with no Node import, so the page can import it as it imports
  `core/text.ts`:
  - `interface ModelChoice { value: string; label: string }`.
  - `modelLabel(name)`: `claude-<family>-<major>[-<minor>]` reads `"<Family> <major>[.<minor>] (<name>)"`
    ("Sonnet 5.5 (claude-sonnet-5-5)", "Fable 5 (claude-fable-5)"); `gpt-<major>[.<minor>]-<word>` reads
    `"GPT-<major>[.<minor>] <Word> (<name>)"` ("GPT-6.1 Sol (gpt-6.1-sol)", "GPT-5.3 Codex (gpt-5.3-codex)"). Any
    other name (an alias, a model of a shape the product does not know) reads as itself.
  - `modelChoices(agent, known, ran)`: `known` is the names of the price table (`Object.keys(readPrices())`, so a
    person's `prices.json` adds to it). An agent's models are told by their prefix: `claude` takes `claude-…`,
    `codex` takes `gpt-…`, any other agent (kimi, command) none. **Newest first** means by the version number, highest
    first (5.5, 5.1, 5, 4.8, …); models of one version keep the price table's order (so Opus 5.5, Sonnet 5.5,
    Haiku 5.5, then Fable 5.1). A name with no version comes after those with one, in the table's order.
    `ran` is the account's sessions on this machine, latest first, each `{ asked, model }`. After the known
    models, in that order and each once: an `asked` name the list does not know, labelled
    `"<asked> (last ran as <model>)"` when the session's `model` is another name, else `"<asked>"`; then a `model`
    the list does not know, labelled as itself. A name the list already has is not added again.
  - `withBound(choices, bound)`: a bound model the list does not have comes first, labelled as itself; a bound model
    the list has, or none, leaves the list as it is (the list's own label wins, so a bound `sonnet` still says what
    it last ran as).
- **Which version an alias last ran as needs a record of what was asked.** The `model` of a session is the one the CLI
  says did the work (`claude-sonnet-5-5`), not the alias the binding named. A new migration, appended to `MIGRATIONS`
  in `src/core/db.ts` (never editing a shipped one): `alter table sessions add column asked_model text;`.
  `recordSession` stores the binding's model for the lane's tier there (null when the tier names none); `Bound` in
  `src/core/agents/index.ts` gets `model?: string` from `adapterFor` (the `choice.model` it already works out), and
  `Session` in `src/core/store.ts` gets `asked_model: string | null`. Older rows have null and simply say no version.
  Inferring the alias from the model's name (`sonnet` from `claude-sonnet-…`) was rejected: it would credit an
  explicitly bound model's run to the alias.
- **"This machine's session records"** are the workspace's own database (`.factor/state.db`), the one `sessions` and
  `cost` read. Sessions are matched to an account by the `account` column.
- **The view.** `AccountsView.accounts[]` gets `models: ModelChoice[]` = `modelChoices(agent, known, ran)` for that
  account. `accounts_list` (page, API, operator MCP) gets it with no further code. No login's place is told by it.
- **The page (`src/ui/Accounts.tsx`).** `RoleRow` is exported (the render test draws it) and takes
  `accounts: AccountsView["accounts"]` in place of the names. Each tier is a `<select>` with the aria-label
  `Model for <tier> lanes of <role>` (as the text field had), its options in this order: `the CLI's own` (value
  `""`), `withBound(list, bound)` where `list` is the chosen account's `models` and `bound` is the tier's bound model
  while the row's account is still the bound one, then `Another model`, whose value is a constant that is not a valid
  model name (such as `"+another"`) and is never sent. Choosing `Another model` shows a text field under the select,
  aria-label `Another model for <tier> lanes of <role>`, empty, with the same look as the selects; what is typed
  there is the tier's model, and an empty one is the CLI's own.
- **Changing the account.** When the row's account changes to one of **another agent** than the one before, every
  tier that names a model is set back to the CLI's own, and the row says so under the account select, naming them:
  `The models were cleared: claude-preview-6, claude-sonnet-5-5 and claude-opus-5-5 are not models of Codex.` (it
  must contain "cleared" and each model's name). An account of the same agent keeps the models. Agent names in words:
  claude "Claude Code", codex "Codex", kimi "Kimi", command "a command".
- **Widths and looks** (`src/ui/sections.css`): the selects of the roles table take their own width (`width: auto`, no
  `width: 100%`), which is the width of their longest option, and the same height, border, radius, background,
  colour and font as the text field; on the 390 layout (the table becomes a grid) they may be as wide as the cell,
  never narrower than their longest option, and the page must not scroll sideways. Measured in the browser check as:
  no select of the roles table is narrower than its longest option's text, plus its left and right padding, plus 12 px
  for the arrow.
- **`role list`** prints after the account, for a role bound to an account, two spaces and
  `small <model>, medium <model>, large <model>`, with `the CLI's own` for a tier that names none, and `, effort <e>`
  when an effort is set. A role worked by the scripted agent, or not bound, prints no models. The same-vendor flag
  stays at the end of the line. Example:
  `author           claude-main (claude)  small the CLI's own, medium sonnet, large claude-opus-5-5, effort high`.
- **The rest of `.factor/local.json`** is already kept by `role bind` (commit 2ee2698), and the page binds through it
  (`roles_bind` runs the command). The acceptance test and the browser check pin it; no code is expected for it.
- **Not done:** no new alias list of its own (an alias is offered when it is bound or was run here, and can always be
  typed under "Another model"); no list for kimi or command accounts beyond what they ran; no model list in
  `account list`; no change to `role bind`'s flags.

## Acceptance criteria

1. Given the price table, when the list of an agent is made, then `modelChoices("claude", …)` holds only the
   `claude-` models, newest version first (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`,
   `claude-fable-5-1`, `claude-fable-5`, `claude-opus-5`, `claude-sonnet-5`, `claude-opus-4-8`, `claude-opus-4-7`,
   `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5`), `codex` only the `gpt-` ones in the same rule, kimi
   and command none; and each label is the model with its version ("Sonnet 5.5 (claude-sonnet-5-5)",
   "GPT-6.1 Sol (gpt-6.1-sol)"), an alias or an unknown shape its own name.
2. Given sessions of the account, when the list is made, then an alias it asked for is one entry after the known
   models, saying the version its latest session ran as ("sonnet (last ran as claude-sonnet-5-5)"); a model it ran
   that the list does not know is added; nothing is listed twice.
3. Given a bound model the list does not know, when the list is given it, then it is first and kept; a bound model
   the list knows, or none, leaves the list as it is.
4. Given a lane whose role binds the alias `sonnet` for its tier, when the Claude CLI says `claude-sonnet-5-5` worked,
   then the session row has `asked_model` `sonnet` and `model` `claude-sonnet-5-5`.
5. Given accounts of Claude Code, Codex and a command, when `accounts_list` is read, then each account has its
   `models`: the Claude one starts with Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1 (labels with versions) and holds
   `sonnet (last ran as claude-sonnet-5-5)`, and no `gpt-`; the Codex one starts with GPT-6.1 Sol, has no `claude-`
   and nothing the other account ran; the command one has none.
6. Given a role row on the page, when it is drawn, then each tier's model is a select whose options are "the CLI's
   own" (value empty), the bound account's list, and "Another model", in that order; the bound model is the one
   chosen; a bound model the list does not know is an option and chosen; a role on a Codex account offers the Codex
   list. The Account and Effort selects are as before.
7. Given the page, when "Another model" is chosen by keyboard, then a text field opens that looks like the selects
   beside it, and the name typed there is the model bound; after binding, that model, which the list does not know,
   is shown and kept in the select.
8. Given a role bound to a Claude Code account, when its account is changed to a Codex one by keyboard, then the
   model selects offer the Codex list and no `claude-` model, every tier is back at the CLI's own, and the row says
   the models were cleared, naming them.
9. Given a role bound to an account, when `softwarefactor role list` runs, then the role's line has, after the
   account, `small <model>, medium <model>, large <model>` with "the CLI's own" for a tier with none, and
   `, effort <e>` when one is set; a role of the scripted agent prints no models.
10. Given the page in a browser, when a role is bound by keyboard only, choosing its models from the list, then the
    page says it is bound, `.factor/local.json` holds exactly that binding, and `softwarefactor role list` prints the
    same account, models and effort.
11. Given `.factor/local.json` with other roles and a key that is not a role (`servers`), when a role is bound from the
    page (the `roles_bind` operation), then the other roles and the other key are unchanged.
12. Given the Accounts page in light and dark at 1440 and at 390 wide, when the screenshots are taken, then no select
    of the roles table is narrower than its longest option's text plus padding plus 12 px, the selects and the text
    field share height, border, radius, background, colour and font, and at 390 nothing scrolls sideways.
13. Given the rest of the suite, nothing else breaks: `ui-accounts`, `sessions`, `cost-*`, `export-*` and the rest
    pass; `pnpm typecheck` and `pnpm lint` are clean.

## Verification contract

- 1: test:test/unit/model-choices.test.ts
- 2: test:test/unit/model-choices.test.ts
- 3: test:test/unit/model-choices.test.ts
- 4: test:test/acceptance/accounts-models.test.ts
- 5: test:test/acceptance/accounts-models.test.ts
- 6: test:src/ui/accounts-models.test.tsx
- 7: ui:pnpm run build && bash test/ui/accounts.sh (steps 1 and 2: another model, kept after binding)
- 8: ui:pnpm run build && bash test/ui/accounts.sh (step 3: the Codex account clears the Claude Code models)
- 9: test:test/acceptance/accounts-models.test.ts
- 10: ui:pnpm run build && bash test/ui/accounts.sh (steps 1 and 2: keyboard binding read back from role list)
- 11: test:test/acceptance/accounts-models.test.ts
- 12: ui:pnpm run build && bash test/ui/accounts.sh <shots> (accounts-{light,dark}-{1440,390}.png, each after the no-cut-off check)
- 13: cmd:pnpm test && pnpm typecheck && pnpm lint

## Files to touch

- `src/core/models.ts` (new): `ModelChoice`, `modelLabel`, `modelChoices`, `withBound`.
- `src/core/db.ts`: a new migration adding `sessions.asked_model`.
- `src/core/store.ts`: `Session.asked_model`.
- `src/core/agents/index.ts`: `Bound.model`, set in `adapterFor`.
- `src/core/engine/session.ts`: `asked_model` from the bound model (and its callers in `src/core/engine/start.ts`,
  which pass the `Bound` through).
- `src/core/views.ts`: `models` on each account, from the price table and the workspace's sessions.
- `src/core/commands.ts`: `role list` prints the models and effort.
- `src/ui/Accounts.tsx`: export `RoleRow`; the model selects, "Another model", clearing on another agent.
- `src/ui/sections.css`: the selects' width and look.
- Tests (written at planning): `test/unit/model-choices.test.ts`, `test/acceptance/accounts-models.test.ts`,
  `src/ui/accounts-models.test.tsx`, `test/ui/accounts.sh` (and `accounts` added to `test/ui/all.sh`).

## Approach

1. Tests first (done at planning). They fail now for these reasons: `src/core/models.ts` does not exist; the
   sessions table has no `asked_model`; `accounts_list` gives no `models`; `role list` prints no models; `RoleRow` is
   not exported; in the browser, the model field of a tier is a text field (`got "INPUT", wanted /^SELECT$/`, after
   the account was picked by keyboard). Criterion 11 passes already (commit 2ee2698): it guards against breaking it.
2. `models.ts` and its unit test green.
3. The migration, `Bound.model`, `recordSession`, the view and `role list`; the acceptance test green.
4. The page and its CSS; the render test green; `pnpm run build`, then `bash test/ui/accounts.sh <shots>` prints
   `accounts: ok`, and the four pictures are looked at.
5. The whole suite, typecheck and lint.

## Done check

- `pnpm vitest run test/unit/model-choices test/acceptance/accounts-models src/ui/accounts-models test/acceptance/ui-accounts test/acceptance/sessions`
- `pnpm run build && bash test/ui/accounts.sh /tmp/shots` (inside a factory run, start it with the `FACTOR_*`
  variables unset, or `softwarefactor init` refuses: `env -u FACTOR_RUN_ID … bash test/ui/accounts.sh`)
- `pnpm typecheck && pnpm lint && pnpm test`

## Risks / out-of-scope

- `test/ui/all.sh` now runs `accounts.sh` after `inbox.sh`, so the `accounts-*` pictures in its folder are this
  check's (with Claude Code and Codex logins), not the inbox check's.
- A Chromium select's own arrow is drawn inside its width; the 12 px allowance in the check is the room for it. A
  custom arrow must sit in the right padding.
- `prices.json` entries a person adds join the list by their prefix; one of another shape is in no agent's list (it
  can still be typed under "Another model").
- The Codex CLI prints no model, so its sessions' `model` is the asked one and its entries never say "last ran as".
