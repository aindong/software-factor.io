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

Any other key is rejected. Text is bounded: a summary of at most 4000 characters, at most 50 claims of 1000
characters with at most 10 references each, at most 50 open items. An output may nest 16 levels and hold 100,000
characters. Larger content belongs in a file whose path is the output.

## Evidence

A claim names its evidence as short references. The host resolves each one itself.

| Reference | Holds when |
| --- | --- |
| `commit:<id>` | The commit is on the run's branch and was made in this run. Give its id, or `HEAD` for the branch's tip. A branch or tag name is not accepted. |
| `file:<path>` | That path is a committed file (not a folder) at the run's head. |
| `attached:<name>` | A plain file of that name is in the evidence folder the agent was given: under 20 MB, not a link, at most 20 files and 50 MB per hand-off. When the whole hand-off is accepted, the host copies each file into `.factor/runs/<run>/evidence/` and records its hash. |
| `gate:<lane>.<gate>` | That gate passed earlier in this run. A lane cannot cite its own gates: they run after the hand-off. |

Evidence that exists is not evidence that proves the claim. The check stops a claim with nothing behind it.
Whether the evidence supports the claim is for the review lane and the person.

## Where the files go

Each time an agent starts on a lane, the host gives it a fresh folder outside the repository for its hand-off and
its evidence. The folder is emptied first, so nothing an earlier lane left there can be taken for this lane's.

When a hand-off is passed to the next lane, it is quoted line by line under a heading that says another agent
wrote it. The next agent can read it. It cannot be mistaken for the host or the person.

## Risk

The run's risk is the highest level any lane stated. The host raises `low` to `medium` when the door is one-way
or the change touches sensitive files, and says so. A later lane cannot lower the level or rewrite the reason: only
a higher level replaces it. A one-way lane or a sensitive change is at least medium even when no lane stated a
risk. Otherwise, when no lane stated one, the run reads "not assessed".

## The hand-off to a person

When a run stops or waits, the host writes `.factor/runs/<run>/handoff.md`: each lane with its outcome, its gate
results and their evidence files, its claims, what is still open, the risk, why the run stopped, and what to do
next. `softwarefactor status` names the file.
