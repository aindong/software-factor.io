# Costs

`softwarefactor cost` shows where the tokens and the money went. Every number comes from the session records:
one row for each start of an agent on a lane, holding what the agent's own CLI printed about that start. The
interface's Costs page shows the first three tables of the same report.

```
$ softwarefactor cost
By task
  Add the export                  3 sessions        48210 tokens  $0.61
By lane                            sessions        input       output   cache read  cache write       tokens  cost
  implement                               2         1210         3400        38000         2100        44710  $0.52
  review                                  1          400          900         2200            0         3500  $0.09
By account
  work                            2 sessions        44710 tokens  $0.52
  spare                           1 session          3500 tokens  $0.09
By model
  claude-opus-5-5                 2 sessions        44710 tokens  $0.52  cache 92%
  gpt-6.1-sol                     1 session          3500 tokens  $0.09  cache 84%
Total                             3 sessions        48210 tokens  $0.61
Cache hit rate                  91% of what went in was read from a cache
Landed
  1 of 1 ended task landed
  cost per landed task         $0.61  (every run of those tasks)
```

## What each part says

- **By task, By lane, By account, By model.** The sessions, their tokens and their known cost. By lane also
  shows the four kinds of tokens: input, output, read from a cache, written to a cache.
- **Cache hit rate.** Cache read tokens over everything that went in (input, cache read and cache write),
  rounded down. It is pooled over all sessions, not a mean of the lines. The scripted agent names no kinds of
  tokens and has no cache: its sessions are left out. With nothing to divide, the report says "none", not 0%.
- **Landed.** A task has landed when it ended done. The cost per landed task is the known cost of every run of
  those tasks, the runs that stopped on the way included, divided by their number. What was spent on tasks that
  did not land, and on tasks that are still open, is shown beside it. The three amounts add up to the total.
- **Most expensive runs that did not land.** Up to five runs that stopped or were dropped, by the cost that is
  known. A run says how many of its sessions that amount leaves out (a start that was cut off prints no cost). A
  run with no known cost at all comes after the others, by its tokens, and says "unknown".

A cost that is not known is never shown as nothing spent. A line says how many of its sessions have no known
cost, and the amount beside it leaves those out.

## Where a cost comes from

The Claude CLI prints what a session cost, and that is what is recorded. Codex prints tokens and no cost: its
tokens are priced from a list of the vendors' prices for an API key, in dollars per million tokens. A Claude
session with no cost printed is priced from the same list. `softwarefactor sessions` marks such a row "priced
from the table". A model that is not in the list has no price, and its sessions are of unknown cost: the factory
does not guess.

On a subscription login nothing is billed per token. The cost shown is what the same usage would have cost on
an API key. Use it to compare lanes, models and runs, not as a bill.

The list is in `src/core/prices.ts`, with the day and the place each price was read. Prices change: put your
own in `prices.json` in the factor home (`~/.factor/prices.json`), which adds a model or replaces one.

```json
{ "claude-opus-5-5": { "input": 4, "output": 20, "cacheRead": 0.2, "cacheWrite": 5 } }
```

Two limits of the list: a cache write is priced as one kept for five minutes, and a price that rises past a
context size is not modelled.

## Checking the report

```
$ softwarefactor cost --check
Checked 3 sessions on 2 lanes: 3 transcripts re-read, 0 with no transcript. The report matches the session records, to the token.
```

`--check` exits 0 only when all of this holds:

- Each lane's four kinds and its total in the report are what the lane's session rows add up to, added again by
  the database.
- Each session's total is the sum of its four kinds.
- Each transcript a row names is in its run's own folder, is a plain file, and has the SHA-256 that was recorded
  when the factory kept it.
- For a Claude or Codex session, the tokens the CLI printed in that transcript are the row's four kinds.

Anything else is printed, with the run, the lane and both numbers, and the command exits 1. A transcript that is
gone counts as a failure, and so does a row that holds tokens and names no transcript, or whose agent prints no
tokens that could be read again: a row that cannot be proved is not called proved.

What it cannot prove: that the vendor counted right, anything about a session of the scripted agent (it leaves
no transcript), and a record changed by someone who can write the database and the kept files alike. The check
finds mistakes, in the report and in what was recorded. It is no seal. A Codex transcript that was cut for its size is not re-read, and the check says how many were
not.
