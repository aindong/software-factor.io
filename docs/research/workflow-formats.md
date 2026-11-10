# Workflow formats: what the schema takes from each
Read on 2026-11-10.

Examples are written for this note, not copied.

## GitHub Actions workflow syntax

Source: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax

```yaml
jobs:
  build:
    timeout-minutes: 20
    outputs: { sha: "${{ steps.s.outputs.sha }}" }
    steps: [{ id: s, uses: actions/checkout@<full-sha> }]
  review:
    needs: build
    if: needs.build.outputs.sha != ''
    strategy: { fail-fast: false, matrix: { reviewer: [a, b, c] } }
    uses: org/repo/.github/workflows/review.yml@v2
    secrets: inherit
```

- Shape: a map of jobs keyed by id, each with `steps`. `needs` points back at the jobs that must finish first.
- Conditions: `if` on a job or step, a string expression (`${{ }}`) with status functions such as `always()`.
- Loops and retries: none found in the syntax reference. Not verified as a stated rule. `continue-on-error` lets the run pass anyway.
- Fan-out: `strategy.matrix` with `include` and `exclude`, at most 256 jobs per run. `fail-fast` defaults to true and cancels siblings.
- Hand-off: a job declares `outputs`. A later job reads `needs.<job>.outputs.<name>`. Limit 1 MB per job.
- Limits: `timeout-minutes` defaults to 360. `concurrency` takes `group` and `cancel-in-progress`.
- Secrets: read by name from the `secrets` context. A reusable workflow declares the ones it needs. The caller passes them by name or with `secrets: inherit`.
- Third-party pieces: `uses: owner/repo@ref` for a step, `owner/repo/.github/workflows/file.yml@ref` for a whole job. The ref is a SHA, tag or branch. GitHub says to pin a SHA, because "a tag can be moved or deleted" (https://docs.github.com/en/actions/reference/security/secure-use).
- Permissions: each scope is `read`, `write` or `none`. A called workflow can only lower what it was given (https://docs.github.com/en/actions/reference/workflows-and-actions/reusable-workflows).
- Versioning: the file has no version field. Each piece is versioned by the git ref after `@`.

Easy to read and share: one file, ids as keys, `uses` as one short string, limits and permissions next to the job.

Painful, by GitHub's own account: repeated config (YAML anchors were "one of the most requested features"), limits on reusable workflows (now 10 levels, 50 calls), no parallel steps yet (https://github.blog/news-insights/product-news/lets-talk-about-github-actions/). Also: values inside `${{ }}` in scripts can inject code, and the caller's `env` does not reach a called workflow.

## n8n workflow JSON

Sources: https://docs.n8n.io/workflows/export-import/ and the types in https://github.com/n8n-io/n8n/blob/master/packages/workflow/src/interfaces.ts

```json
{
  "nodes": [
    { "id": "a1", "name": "Fetch", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4,
      "position": [0, 0], "parameters": {},
      "credentials": { "httpBasicAuth": { "id": "17", "name": "my login" } } }
  ],
  "connections": { "Fetch": { "main": [[{ "node": "Check", "type": "main", "index": 0 }]] } }
}
```

- Shape: a flat `nodes` array plus a separate `connections` map keyed by the source node's name, then output kind, then output index. Each target is `{ node, type, index }`.
- Conditions and loops are node types (IF, Switch, Loop Over Items, Merge), not syntax. A branch is another output index (https://docs.n8n.io/flow-logic/).
- Retries: fields on the node: `retryOnFail`, `maxTries`, `waitBetweenTries`, `onError`.
- Secrets: a node holds only `{ id, name }`, keyed by credential type. But n8n warns: "Exported workflow JSON files include credential names and IDs", and names may be sensitive, so strip them before sharing.
- Export and import: download as JSON, import from file or URL, or paste onto the canvas. What import does when a credential id is missing: Not verified.
- Versioning: every node carries `typeVersion`. A saved workflow keeps the version it was saved with, new nodes get the newest, and a node package can ship several versions (https://docs.n8n.io/integrations/creating-nodes/build/reference/node-versioning/).
- The file also carries canvas positions and run data (`pinData`).

## Statecharts: XState v5 and SCXML

Sources: https://stately.ai/docs/machines and its sibling pages (guards, parallel states, invoke), and https://www.w3.org/TR/scxml/

```js
createMachine({ initial: "review", states: {
  review: { invoke: { src: "review", onDone: "done", onError: "revise" } },
  revise: { on: { FIXED: [{ guard: "underLimit", target: "review" }, { target: "stuck" }] } },
  done: { type: "final" }, stuck: { type: "final" } } })
```

- Shape: named states, each with an `on` map from event to transition (`target`, `guard`, `actions`).
- Conditions: a guard is an inline function, a string name, or `{ type, params }`, combined with `and`, `or`, `not`. An event can map to an array of transitions. The first whose guard passes wins. An unguarded last entry is the default.
- Loops: a transition back to an earlier state, bounded by a guard on a counter in `context`. Nothing forces a bound.
- Fan-out: `type: "parallel"`. All regions run at once. `onDone` on the parent fires when every region reaches a `type: "final"` state.
- Work: `invoke: { src, id, input, onDone, onError }`. `src` names an actor supplied in code. It stops when the state exits.
- Retries, secrets, third-party pieces: no keys for these. Code is bound by name at run time.
- Serialising: v5 lets guards and actions be named by "JSON-serializable strings and/or objects", so a config with no inline functions is plain data. A supported JSON round trip in v5: Not verified. XState v6 (beta) documents `machineToJSON` and `machineFromJSON`. Inline actor logic is dropped (https://stately.ai/docs/xstate/v6/serialization).
- SCXML (W3C Recommendation, 1 September 2015) has the same parts as XML: `<scxml version="1.0">`, `<state>`, `<parallel>`, `<final>`, `<transition event cond target>`, `<invoke>`, `<history>`. Entering a `<final>` child raises `done.state.<parent id>`.
- The Cursor skill at https://github.com/cursor/plugins/tree/main/pstack/skills/statechart exists. It is not a workflow format. It model checks a TLA+ spec and draws a Mermaid chart of the shortest path to each broken rule. Useful idea: a state with no way out is always reported.

## Tekton, Argo Workflows and Open Agent Specification

Sources: https://tekton.dev/docs/pipelines/pipelines/ and the Argo and Agent Spec pages listed under Sources.

```yaml
tasks:
  - name: review
    taskRef: { name: review }
    runAfter: [build]
    retries: 1
    when: [{ input: "$(tasks.build.results.status)", operator: in, values: ["ok"] }]
finally:
  - { name: notify, taskRef: { name: notify } }
```

- Tekton conditions are data: `when` is a list of `{ input, operator, values }` with `in` or `notin`.
- Tekton hand-off is declared: named `results`, read as `$(tasks.<name>.results.<result>)`.
- Tekton `finally` tasks always run at the end and can read `$(tasks.status)`. Argo's `onExit` is the same idea.
- Argo `retryStrategy` separates kinds of failure: `retryPolicy` is `Always`, `OnFailure`, `OnError` or `OnTransientError`, plus `limit`. The sub-fields of `backoff`: Not verified.
- Open Agent Specification (release 26.1.0) keeps control edges (`from_node`, `from_branch`, `to_node`) apart from data edges (`source_output` to `destination_input`). Sensitive fields such as `api_key` are left out of the exported file, and a spec must not contain executable code. A file-level version field: Not verified.

## JSON Schema practice and Zod 4

Sources: https://code.visualstudio.com/docs/languages/json , https://zod.dev/json-schema and the others listed under Sources.

- In a schema document, `$schema` names the dialect. In a data file, a `$schema` property is how VS Code finds the schema for completion and hovers. VS Code says this is its own convention. The other routes are the `json.schemas` setting (`fileMatch`, `url`) and JSON Schema Store.
- VS Code supports drafts 4 to 7, with "limited support for drafts 2019-09 and 2020-12".
- Forward compatibility: extra properties are allowed by default. `additionalProperties: false` rejects them.
- Zod 4 is stable. `z.toJSONSchema(schema, params)` is first-party. `target` defaults to `"draft-2020-12"` and also accepts `"draft-07"`. `io` defaults to output; `"input"` matters for defaults.
- `z.object()` emits `additionalProperties: false` in output mode only. `z.strictObject()` always does. `z.looseObject()` never does.
- Types with no JSON Schema form (dates, maps, sets, transforms) throw by default.
- `.meta()` fields are copied into the output, so descriptions become hover text.

## What we take

One lane and one transition. The `$schema` URL is a placeholder.

```json
{
  "$schema": "https://example.com/schema/workflow/v1.json",
  "version": 1,
  "plugins": { "acme": "^2.1.0" },
  "roles": { "reviewer": { "description": "reads diffs, never writes" } },
  "limits": { "minutes": 120, "spendUsd": 20 },
  "lanes": [
    { "id": "review", "uses": "core/agent@1",
      "agent": { "role": "reviewer", "model": "opus", "effort": "high",
        "prompt": "prompts/review.md", "skills": ["code-review"], "mcp": ["github"] },
      "inputs": { "diff": "build.outputs.diff" },
      "outputs": { "findings": { "type": "array" } },
      "gates": [{ "id": "tests", "uses": "core/command@1", "with": { "run": "npm test" } }],
      "checkpoint": "near",
      "limits": { "minutes": 30, "spendUsd": 5 },
      "retry": { "max": 2, "on": ["error"] },
      "on": {
        "pass": "ship",
        "fail": [{ "to": "revise", "maxRounds": 3 }, { "to": "ask-person" }],
        "needsPerson": "ask-person"
      } }
  ]
}
```

- Lane identity and type: a flat `lanes` array. Each lane has a stable `id` and a one-string `uses` (GitHub Actions). Transitions point at ids, never display names (the n8n lesson).
- Agent settings by role: `agent.role` names a role, never an account. A top-level `roles` map declares every role the file needs. A machine-local file binds role to account. Import lists unbound roles. Skills and MCP servers are names only.
- Gates: a list on the lane, each with its own `uses`. The host runs them after the agent exits. The outcome is `pass` only if every gate passes.
- Checkpoints: one field: `"in"` (host waits for a person before leaving the lane), `"near"` (host tells a person and goes on), `"out"` (no person).
- Limits: `limits` at the top and on a lane, with no hidden defaults. A lane can only lower the top-level limits (the GitHub permissions rule). A breach produces `needsPerson`.
- Transitions: an `on` map in the lane keyed by the three fixed outcomes. A value is a lane id, or an ordered array where the first match wins and an unguarded last entry is the default (XState).
- Conditions: data, not an expression string: `"when": { "input": "review.outputs.severity", "in": ["high"] }` (Tekton).
- Bounded loops: a transition that points backwards must carry `maxRounds` and be followed by a default entry for when rounds run out. The host counts. The validator rejects a cycle with no bound and a lane with no way out (the Cursor skill's idea).
- Retries are separate: `retry` covers host errors such as a crashed CLI and does not use up a round (Argo's `retryPolicy`).
- Fan-out: `"panel": { "members": [{ "role": "security" }, { "role": "style" }], "join": "all" }` on a lane. Each member overrides part of `agent`. The outcome is computed when all are done, like a parallel state. No fail-fast by default.
- Hand-off: each lane declares typed `outputs`. `inputs` are plain paths, `<lane id>.outputs.<name>`. The host checks outputs before any transition fires. Large artefacts pass as file paths.
- Plugins: `uses` is `<namespace>/<type>@<major>`, with `core` reserved. The `plugins` map gives a semver range per namespace. A lock file beside the workflow pins exact versions and hashes. A lane keeps the major it was saved with (n8n's `typeVersion`).
- Schema versioning: a `$schema` URL with the major in the path for editors, and an integer `version` for the loader, which migrates older files and refuses newer ones with a clear message.
- One Zod 4 schema is the source of truth. Publish with `z.toJSONSchema(schema, { target: "draft-07", io: "input" })`, use `z.strictObject` so typos fail, put descriptions in `.meta()`. Allow one free-form `meta` object per lane.

Unsure:

- `on` inside the lane or a separate top-level `transitions` array. Inside reads better by hand. A separate array suits a visual editor.
- `maxRounds` on the transition or on the lane being re-entered.
- Whether `in` and `notIn` are enough for conditions.
- Panel `join` rules (`all`, `any`, a quorum) and how member outputs merge.
- `model` as a real name or a tier alias resolved per machine.
- Whether `"draft-07"` output loses anything we need. Not verified.
- A `finally` lane list (Tekton, Argo) for clean-up.

## What we avoid

- A string expression language such as `${{ }}`. It hides logic in strings and invites injection.
- Unwritten defaults that matter, such as a 360 minute timeout or fail-fast.
- Account or credential names and ids in the file. n8n has to warn users to strip them: https://docs.n8n.io/workflows/export-import/
- Edges keyed by display name, canvas positions and run data in the shared file.
- Backward-pointing `needs` or `runAfter`. They cannot express a loop.
- Nested states, history states and inline code.
- Unbounded loops. A guard on a counter is easy to forget, so the bound is required.

## Sources

- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- https://docs.github.com/en/actions/reference/workflows-and-actions/reusable-workflows
- https://docs.github.com/en/actions/reference/security/secure-use
- https://github.blog/news-insights/product-news/lets-talk-about-github-actions/
- https://docs.n8n.io/workflows/export-import/
- https://docs.n8n.io/integrations/creating-nodes/build/reference/node-versioning/
- https://docs.n8n.io/flow-logic/
- https://github.com/n8n-io/n8n/blob/master/packages/workflow/src/interfaces.ts
- https://stately.ai/docs/machines
- https://stately.ai/docs/guards
- https://stately.ai/docs/parallel-states
- https://stately.ai/docs/invoke
- https://stately.ai/docs/xstate/v6/serialization
- https://www.w3.org/TR/scxml/
- https://github.com/cursor/plugins/tree/main/pstack/skills/statechart
- https://tekton.dev/docs/pipelines/pipelines/
- https://argo-workflows.readthedocs.io/en/latest/retries/
- https://argo-workflows.readthedocs.io/en/latest/walk-through/exit-handlers/
- https://oracle.github.io/agent-spec/development/agentspec/language_spec_nightly.html
- https://json-schema.org/understanding-json-schema/reference/schema
- https://json-schema.org/understanding-json-schema/reference/object
- https://code.visualstudio.com/docs/languages/json
- https://zod.dev/json-schema
- https://zod.dev/v4
