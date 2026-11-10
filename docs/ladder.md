# The autonomy ladder

Every lane of a workflow has a checkpoint. Seen together, the three checkpoints are steps a lane climbs on its
record:

1. **in the loop**: a person approves the lane's work before the run goes on (a command or a wait is approved
   before it runs).
2. **near the loop**: the lane goes on by itself.
3. **out of the loop**: the lane goes on by itself, and nothing is said.

A new lane starts in the loop. Nobody sets a lane to a higher step on day one and calls it trust: a lane moves
up when its record has earned it and a person takes the step.

## The record

```
$ softwarefactor ladder
Lane    Stands           Record
build   in the loop      10 of 10 runs in a row: it can move near the loop
ship    out of the loop
To move build near the loop: softwarefactor ladder accept build
```

A lane's record is the number of runs in a row, counted back from the newest, that went through the lane and
ended done with the lane's work left as it was. What ends the row:

- the lane's work was sent back or rejected by a person,
- the run ended at the lane because the lane's own work failed (its gates, its agent, its command, its rounds
  used up). A try that failed and was mended inside a run that ended done does not end the row: that is the
  loop doing its job,
- a defect that got through the lane was reported (an escape),
- the lane moved on the ladder, or its checkpoint was changed in the workflow's file by anything else. The
  record then starts again from that moment: what was earned on one step is not carried to another.

A run that is still moving or waiting is not counted yet. A run that ended for another reason (another lane, a
person's stop, a crash, a budget) says nothing about this lane and is skipped. Only runs of the workflow the workspace runs now count, and only visits
to the lane that began after it last moved.

In the loop, a clean run is one a person approved as it was. Near the loop nobody approves: a clean run there
is one that ended done and that nobody has reported a defect for. That is a weaker record, and the step out of
the loop rests on it. Report what you find.

The factory suggests a step after 10 runs in a row. A workspace can ask for another number in
`.factor/factory.json`:

```json
{ "ladder": { "runs": 20 } }
```

## Taking a step

```
$ softwarefactor ladder accept build
build is now near the loop (it was in the loop)
```

The lane's `checkpoint` changes in the workflow's file, the move is recorded with the record it rested on, and
the count starts again from 0. A lane with no suggestion cannot be moved this way, and the refusal says why.

In the interface the same is at the lane: open a lane on the floor, and under its checkpoint the inspector
shows the record, the last move and, when a step has been earned, a button that takes it. The button is off
while the floor holds changes that are not saved.

Two kinds of lane never move up, whatever their record:

- a lane with `"pin": true`: the ladder leaves it where it is, in both directions,
- a lane with `"oneWay": true` (it does something that cannot be undone): it stays in the loop.

## When a defect got through

```
$ softwarefactor escape 5ca65c08 --lane review --note "The export left out refunded orders"
recorded: an escape through review in run 5ca65c08
review is back in the loop (it was near the loop)
```

Name the run, the lane whose check or review should have caught it (`--lane`), and what got through
(`--note`). The escape is recorded, and the lane moves one step back at once: out of the loop to near the
loop, near the loop to in the loop. Nobody is asked, because a step back is the safe direction. A lane that is
already in the loop, or is pinned, stays where it is, and its count starts again.

One defect is one step: a second report for the same run and lane is refused. The run must have ended.

## What the ladder trusts

The ladder moves a lane only through these two commands, and both are denied to an agent in a lane. It does not
stop someone from writing another checkpoint into the workflow's file: the floor, an editor and an import can
all do that. What it does is notice. A checkpoint that is not the one the ladder left is shown as "set outside
the ladder", and the lane's record starts again from there.

## Not built

- The inbox notice for a lane near the loop ("the person gets an item with the evidence and can stop or redo
  it"). A lane near the loop goes on by itself, and its runs are seen on the Runs screen.
- A step back when an approval needed an edit. In the loop there is no lower step, so a send-back only ends
  the row of clean runs.
- A reviewer's veto rate as part of the record.
- A lane's identity beyond its id: a lane that is rewritten under the same id keeps its record.
- The retro an escape opens. It comes with `softwarefactor retro`.
