# The interface: Runs

Part of [the interface](interface.md).

Runs lists every task the factory has taken, the newest first: every run that is moving or waiting, and the
latest ended ones up to 50 in all. Each row has the task, a strip map (one stop for each lane: a blue disc
passed, a vermilion diamond failed, a yellow square asked a person, a ring is not reached, and the train is on
the lane the run is at) and one sentence about what is happening now. The list follows the record by itself:
the server sends it again whenever it changes, so a run started in your terminal appears without a reload.

Every row says its state in a word on its first line, in the same place on each row, with its mark: Working,
Waits for you, Waits by itself, Done, Stopped or Dropped. A run that a person stopped is Stopped with a
plain ring: the diamond means a failure and nothing else. The sentence under the strip is the detail, and is
left out when it would only repeat the word. The same word and mark head a run's page. A run that is working
has a mark that is a ring with a
dot, unlike the disc of a done run, the diamond of a stopped one and the yellow square of one that waits for
you. On its map the lane where the work is going on has a ring that breathes, and the line the task came along
carries dashes that run the way it goes; the strip map's train breathes too, and the rail shows the same mark
by Runs while any run works. A run that is working also says how long its lane has worked ("3m 10s at work" on its
row, "Working for" on its page, and "Last output" when the agent has printed something), and what it has used is
"Used so far". That time is a number that ticks every second (every 15 seconds with reduced motion), not an
animation. A run that waits, is stopped or is done is still. With reduced motion in your
system's settings nothing moves: the ring, the dashes and the mark stay as still marks of the same meaning.

The sentence comes from the record. For an agent at work it is read from the last lines of its CLI's output:
"Build: the agent is running `npm test`." It holds no clock, so it changes only when something happens.

A row that waits for you is in full ink and bold; a done row steps back. The way back to the list, at phone
width, is a link with an arrow.

The top bar has a filter by state: All and one button for each state that has a run, with its count. Tab to
it and press Enter or Space; the chosen one is pressed. It is kept in the address (`/runs?show=working`), so a
reload and a shared link keep it, and the heading says "1 working, 1 shown of 3". A filter that leaves nothing
says "No run is working." with a button back to All. A run that is open stays open when it no longer matches:
the list says that it is not among those shown.

The arrow keys move through the list and Enter goes into a run. A stopped run can be put back in the
queue from its page, and a working one stopped. A run shows:

- **Its map.** The workflow's diagram, read only, with what the run did at each station and the lines it took
  lit. The Replay control steps through the run with the arrow keys: at each step the map shows the run as it
  was then. The map is the
  workflow the run ran on, kept with the run when it started (`workflow.json` in the run's folder). It is never
  drawn smaller than its own size: where it does not fit, it scrolls sideways and says how many stations are
  out of sight, as the Floor's map does. Changing the workflow later does not redraw
  what past runs did. A run from before that record was kept is drawn on today's workflow, and says so.
- **Its head, in plain words.** The title, the state, then one sentence for what it is doing or how it ended
  ("At work in Build.", "Stopped before it finished.") and one for whether it needs a person ("This needs you."
  or "Nothing is needed from you."). The record's own sentence, which can be a shell command, follows it
  quietly. The facts are when it started, how long it took (in minutes and hours) and what it cost; the run's id
  and branch come last and are quieter. Tokens are with each lane.
- **A stopped run opens on its failure.** When a run stopped on a gate, "What failed" stands under the head
  and above the map: the lane, the gate in plain words and its output. A task queued again says "queued
  again" beside the state and links to the Floor. A lane that a
  person stopped says "stopped", not "failed", on its card, in the replay and on the map.
- **What each lane did**, before anything else under the map: for each visit its name, how it ended, how long it
  took and its cost, then what its agent said as whole sentences (the record keeps the first 500 characters and
  adds dots; the page drops the unfinished last sentence) and one line on its gates ("5 gates passed", or which
  one failed). Under that, one button, "Evidence for Build", opens in place the lane's claims with each
  reference (it says whether the host checked it; a commit or a changed file opens the diff), each gate with
  its command, exit code and output, the hand-off as lines, and what the agent printed, with its tokens. Nothing
  technical is on the page until that button is pressed. A gate that also ran on the base commit shows that
  output beside its own. Several pieces of evidence can be open at once, and what is opened is scrolled into view. A station on the run's map leads to
  that lane's part.
  What the agent printed opens as an account: what it said, each tool it used as one line with its main
  argument, the first lines of what came back (the rest one click away), a failed call marked, and the end with
  what the session used. Hook and bookkeeping events are left out, with a count. This reads the output of
  Claude Code and of Codex; a line in any other shape is shown as it is. "The lines as printed" shows the raw
  output.
- **The diff** of the whole run, from its base commit to its head, with every changed file named above it. A
  line put in stands on a band and a line taken out is outlined: blue and vermilion mean passed and failed, so
  they are not used here.
- **Files the agents attached**, as one row ("18 files") that opens the list. Two images of one lane whose names
  differ only in the word `before` or `after` (`list-before.png`, `list-after.png`) are shown side by side. A
  `.webm`, `.mp4` or `.mov` plays as a recording. Anything else is shown as text or offered as a download.
- **What waits for you**, said once, under the title and before the facts, with a yellow "Decide in the
  inbox" link and the command that does the same. On a narrow screen the map is scrolled to the lane that
  waits, to the lane that failed, or to where the run ended.

A task put back in the queue is started by the Run button on the Floor or by `softwarefactor run`.
The replay slider, a reference in a lane's evidence, and a station or a badge on a map can be hit on at
least 24px each way at desk width and 44px at phone width.

The type is Inter (variable, optical size) and JetBrains Mono for code, one face for the rail and the map too:
body 15px at 400, data 15px at 500, labels 13px at 500, headings at 600 at most. Nothing in a run's page is under
13px; only the map's sub labels are 12px. On the map, a label that would touch its neighbour's steps out to a
further row (38px up or down, measured in the page once the face has loaded), so no two labels overlap.

On the floor, "Runs on map" puts a numbered train on the lane of each run that is moving or waiting. The
number is the task's, the same as in the rows of Runs and Inbox. A train is a link to its run. One that waits
for a person is yellow and leads to its decision in the inbox. The lane a working run is in is ringed and the line
it came along has running dashes, as on the run's own map.

A run that was entered is in the address (`/runs/<run>`, and `/inbox/<run>` for its decision), so Back leaves
the run, a reload keeps it, and the address can be passed on.

A file of a run is served only when it is a plain file inside that run's own folder under `.factor/runs/`, with
no link on the way, and only as an image, a video, plain text or a download. An `.html` or `.svg` file an agent
attached is shown as its text. It is never run as a page.
