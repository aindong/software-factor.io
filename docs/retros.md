# Retros and lessons

A factory that makes the same mistake twice has learned nothing. Two things open a retro:

- **An escape**: a defect that got through a lane and was found later, reported with
  `softwarefactor escape <run> --lane <lane> --note "<what got through>"` (`docs/ladder.md`).
- **A repeat**: the same gate failing at the same lane, or the same lane's work sent back or rejected, in
  3 of the last 20 ended runs of the workflow.

```
$ softwarefactor retro
1  open     escape  lane review, run 5ca65c08: The export left out refunded orders
2  open     repeat  lane build: the gate verify failed in 3 of the last 20 runs (a1, b2, c3)
To look into one: softwarefactor retro draft 1
```

A repeat is one retro for its lane and gate, however often it goes on. After it is kept or dropped it is opened
anew only if the same thing happens three more times in runs that ended later: a lesson that did not help is
news.

## The draft

```
$ softwarefactor retro draft 1
drafted: .factor/retros/2026-11-11-escape-review-1.md
```

The draft is a file under `.factor/retros/`, written from the record: what happened, what was said (quoted,
line by line, because a person or an agent wrote it), and each gate of the lane in those runs with its result
and the path of its output. Three parts are left for you: why it got through, the lesson in one line, and the
check that would catch it. The file is yours once it is written: a second `draft` does not write over it.

## The lesson

```
$ softwarefactor retro keep 1 --lesson "Check an export against orders of every status, refunded ones too."
kept: .factor/memory/lessons/check-an-export-against-orders-of-every-status-refunded-ones.md
```

A lesson is one line of plain text. It is kept as a file under `.factor/memory/lessons/`, which says where it
came from in the factory's own words: nothing an agent or a task's author wrote is carried into it. From then on
every lane is given it with what the project remembers (`softwarefactor memory list`). Commit the file: that is
how the lesson reaches the people you work with, and how they review it.

A retro that is not worth a lesson is dropped, with the reason:

```
$ softwarefactor retro drop 2 --note "The gate was wrong, and is mended"
```

## The check

A lesson is words. Where the mistake can be caught by a command, add a gate, so that it is caught the next time
whatever the agent remembers. The draft ends with a gate entry to start from:

```json
{ "refunds-in-export": { "uses": "core/command@1", "with": { "run": "node scripts/check-export.mjs" }, "onFail": "fail" } }
```

Add it under `gates` in the workflow and name it in the lane's `gates`, on the floor or in the file. It is a
change to a file of the repository, reviewed like any other. The factory does not write gates.

## Who can change what the factory has learned

A person, in the repository. Not a lane:

- The `softwarefactor` command is denied to an agent in a lane, and `retro`, `memory keep`, `ladder accept` and
  the rest refuse to run inside a run.
- The factory reads its memory, its workflows and its settings from the workspace, never from a run's change.
- A lane whose change holds a file under `.factor/memory/`, `.factor/workflows/` or `.factor/retros/`, or
  `.factor/factory.json` or `.factor/plugins.lock.json`, fails, whatever gates the workflow has. So such a change
  cannot ride into the repository inside a run's branch.

## Not built

- Finding two review findings that mean the same in different words. A repeat is what the factory can count.
- Writing the gate. The draft gives a place to start.
- Taking a lesson out when it has stopped being true: remove its file.
- A lesson that applies to one lane only: every lane is given every lesson.
