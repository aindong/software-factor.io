# The hand-off

When an agent finishes a lane it leaves a hand-off: one JSON file that says what it did, what it claims, and
what is still open. The host checks the file before anything is done with it. A hand-off that fails the check is
rejected: the lane does not pass, and if the lane has repair rounds left the agent is told why and may write it
again.

The agent is given the path to write to. It is outside the repository, so a hand-off is never committed.

```json
{
  "outcome": "pass",
  "summary": "Added the export button and a test for the empty list.",
  "claims": [
    { "text": "The button is on the list page.", "evidence": ["file:src/pages/List.tsx", "attached:after.png"] },
    { "text": "An empty list exports a file with only the header.", "evidence": ["commit:HEAD"] }
  ],
  "open": ["The button label is a guess. The design does not name it."],
  "risk": { "level": "low", "door": "two-way", "why": "One new button on one page.", "blastRadius": "The list page." },
  "outputs": { "planPath": "docs/plan.md" }
}
```

| Key | Meaning |
| --- | --- |
| `outcome` | `pass`, `fail` or `needsPerson`. Required. A `pass` only means the gates are worth running: the host's gates decide. |
| `summary` | What was done, or the question for a person. Required. |
| `claims` | Each thing the lane asserts, with at least one piece of evidence the host can find. |
| `open` | What is still open or unsure. It is shown to the next lane and to the person who takes over. |
| `risk` | `level` (`low`, `medium`, `high`), `door` (`two-way`: undoing the change undoes its effect; `one-way`: it cannot be undone), `why`, and optionally `blastRadius`. |
| `outputs` | The values the lane declared in the workflow. A required one must be there, with the declared type, and nothing undeclared. |

Any other key is rejected.

## Evidence

A claim names its evidence as short references. The host resolves each one itself.

| Reference | Holds when |
| --- | --- |
| `commit:<rev>` | The commit is on the run's branch and was made in this run. `commit:HEAD` is the branch's tip. |
| `file:<path>` | The file is committed at the run's head. |
| `attached:<name>` | A file of that name is in the evidence folder the agent was given, under 20 MB. The host copies it into `.factor/runs/<run>/evidence/` and records its hash. |
| `gate:<lane>.<gate>` | That gate passed earlier in this run. A lane cannot cite its own gates: they run after the hand-off. |

Evidence that exists is not evidence that proves the claim. The check stops a claim with nothing behind it.
Whether the evidence supports the claim is for the review lane and the person.

## Risk

The run's risk is the highest level any lane stated. The host raises `low` to `medium` when the door is one-way
or the change touches sensitive files, and says so. When no lane stated a risk, the run reads "not assessed".

## The hand-off to a person

When a run stops or waits, the host writes `.factor/runs/<run>/handoff.md`: each lane with its outcome, its gate
results and their evidence files, its claims, what is still open, the risk, why the run stopped, and what to do
next. `softwarefactor status` names the file.
