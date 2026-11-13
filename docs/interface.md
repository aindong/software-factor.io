# The interface

```sh
softwarefactor ui            # prints the address to open, on port 4390
softwarefactor ui --port 0   # any free port
```

Open the address exactly as printed. It ends in `#t=` and a key for this session.

The interface runs on your machine and nowhere else. It is built into the package, fonts included, and loads
nothing from a network.

## The floor

The workflow is drawn as a line diagram, the way a transit map draws a network:

- A lane is a station, in the order of the workflow file. A lane that waits for a person is a longer capsule.
- The route a task takes when a lane passes is blue, when it fails vermilion, when it asks a person yellow.
  A route that ends the run is grey. A route taken only on a condition is dotted.
- Lines of one outcome that lead to the same station run together, like branches of one line: every lane that
  fails to "Stopped" is one grey line with a spur from each lane.
- A line that goes back shows how many times it may: `fail ×2`.
- The short bars after a station are its gates.

The map is laid out from the workflow itself. The file holds no positions, so there is nothing to drag into
place, and two people looking at the same workflow see the same map.

What you can do:

| With the mouse | With the keyboard |
| --- | --- |
| Click a station to select it | Tab into the map, then the left and right arrows |
| Double-click to open it in the inspector | Enter |
| Drag from a station's blue or vermilion handle to another station | `c`, then choose where it goes |
| The Agent, Command and Wait buttons add a lane after the selected one | The same buttons |
| Save | Ctrl-S or Cmd-S |

A new lane is placed on the line: the lane before it now passes to it, and it passes on to where that lane
passed before. A connection that goes back gets a round limit of 2 and a way out to "Stopped", which the format
requires. Removing a lane sends the lines that came to it on to where it passed to.

The inspector, on the right, holds the selected lane's settings: its id and name, its checkpoint, its agent's
role, access, model size, effort and instructions, where each outcome leads, and its gates. With nothing
selected it holds the workflow's own description and limits.

## The ladder at a lane

Under a lane's checkpoint the inspector shows the lane's place on the autonomy ladder (`docs/ladder.md`): its
record of clean runs in a row, the last time it moved and why, and, when the record has earned a step, a button
that takes it. Taking a step changes the workflow's file, so the button is off while the floor holds changes
that are not saved. A step back after a defect got through is made from the command line
(`softwarefactor escape`) and is shown here.

## The JSON, one click away

The Diagram and JSON switch shows the same workflow as text. A change in either shows in the other at once.
While the text is not valid JSON the diagram keeps the last version that was, and says so.

Roles, gates, collectors, panels and conditions on a transition are edited in the JSON view. The diagram
draws them.

## Problems

The same checker the command line runs (`softwarefactor check`) runs in the page on every change. Each problem
is listed with its place and its fix, and the station it is about is flagged. Save is off while there is one.
Saving checks again on the server, and writes nothing unless the checker finds nothing.

A new agent lane starts with no instructions. That is a problem until you write them: the floor does not
write a lane's instructions for you.

## A file changed elsewhere

The floor remembers which version of the file it read. If the file is changed elsewhere (in an editor, by
`git`, by another tab) while the floor holds no change of its own, the floor reads it again when you come
back to it. If the floor holds a change too, Save writes nothing and says so. You choose: read the file
again, which drops the change made here, or save over it. The `workflow_save` operation does the same for
any caller that names the version it began from (`base`).

## What keeps others out

A workflow decides what runs on your machine, so who may save one matters. Two kinds of others can reach a
server on your machine: a page on some other site, which can make your browser send requests to it, and any
other process on the machine, a coding agent included.

- The server listens on 127.0.0.1 only and refuses any request that names another host.
- Every API call must carry a token. The token is given once, in the address the command prints in your
  terminal, after the `#`, where a browser never sends it. The page takes it from there, keeps it for the tab,
  and removes it from the address bar. The page itself holds no token, so asking the server for the page gives
  nothing that opens the API. A tab opened without the key says so.
- When the server is started again it has a new key. A tab from before loads itself again and says it has no
  key, unless the floor in it holds a change that is not saved. That tab is kept as it is, and a notice at its
  foot, on whatever section it shows, says so and takes the new address: paste it there, and the tab has the new
  key without loading again, so the change can be saved. The notice then says "Key taken. Save to keep your
  changes." for a few seconds. While the key is refused, the top bar of Runs and Inbox says so instead of
  "Trying again", since waiting does not help. On the floor itself, opening the new address in the tab does
  the same.
- No other site can read the server's answers or put the page in a frame.
- A save writes only a plain file in this repository's own workflows folder, never through a link, and only
  what the checker accepts.
- The guard denies an agent the `softwarefactor ui` command, and the command refuses to start inside a run.

What this does not stop: a process running as you can read your terminal's output or the workflow files
themselves. Only a sandbox for the agents stops that.

## Runs

Runs lists every task the factory has taken, the newest first: every run that is moving or waiting, and the
latest ended ones up to 50 in all. Each row has the task, a strip map (one stop for each lane: a blue disc
passed, a vermilion diamond failed, a yellow square asked a person, a ring is not reached, and the train is on
the lane the run is at) and one sentence about what is happening now. The list follows the record by itself:
the server sends it again whenever it changes, so a run started in your terminal appears without a reload.

Every row says its state in a word on its first line, in the same place on each row, with its mark: Working,
Waits for you, Waits by itself, Done, Stopped or Dropped. The sentence under the strip is the detail, and is
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

The top bar has a filter by state: All and one button for each state that has a run, with its count. Tab to
it and press Enter or Space; the chosen one is pressed. It is kept in the address (`/runs?show=working`), so a
reload and a shared link keep it, and the heading says "1 working, 1 shown of 3". A filter that leaves nothing
says "No run is working." with a button back to All. A run that is open stays open when it no longer matches:
the list says that it is not among those shown.

The arrow keys move through the list and Enter goes into a run. A run shows:

- **Its map.** The workflow's diagram, read only, with what the run did at each station and the lines it took
  lit. The Replay control steps through the run with the arrow keys: at each step the map shows the run as it
  was then. The map is the
  workflow the run ran on, kept with the run when it started (`workflow.json` in the run's folder), and drawn
  small enough to fit its box down to seven tenths of its size. Changing the workflow later does not redraw
  what past runs did. A run from before that record was kept is drawn on today's workflow, and says so.
- **Its head, in plain words.** The title, the state, then one sentence for what it is doing or how it ended
  ("At work in Build.", "Stopped before it finished.") and one for whether it needs a person ("This needs you."
  or "Nothing is needed from you."). The record's own sentence, which can be a shell command, follows it
  quietly. The facts are when it started, how long it took (in minutes and hours) and what it cost; the run's id
  and branch come last and are quieter. Tokens are with each lane.
- **What each lane did**, before anything else under the map: for each visit its name, how it ended, how long it
  took and its cost, then what its agent said as whole sentences (the record keeps the first 500 characters and
  adds dots; the page drops the unfinished last sentence) and one line on its gates ("5 gates passed", or which
  one failed). Under that, one button, "Evidence for Build", opens in place the lane's claims with each
  reference (it says whether the host checked it, and one that names a file opens that file), each gate with
  its command, exit code and output, the hand-off, and what the agent printed, with its tokens. Nothing
  technical is on the page until that button is pressed. A gate that also ran on the base commit shows that
  output beside its own. Several pieces of evidence can be open at once. A station on the run's map leads to
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
- **What waits for you**, under the head, with a yellow "Decide in the inbox" link and the command that does
  the same. On a narrow screen the map is scrolled to the lane the run is at, or to where it ended, and a soft edge shows where it goes on.

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

## Inbox

The rail shows in yellow how many runs wait for you. The inbox lists them, an approval or a question each, with
the run's map and evidence beside the one that is chosen, so you decide with the proof in view. In that
detail the lane the decision is about comes first, under the title and above the map, with its evidence
open: "What you are approving" for work that waits for approval, "What ran before this approval" (the last
lane that ran, or a plain sentence when none has) for an approval asked before a lane runs, and "The lane
that asked" for a question. The other lanes follow, closed, under "What each lane did". The run's page under
Runs keeps its own order.

| Key | Does |
| --- | --- |
| `a` | Approves. The run goes on at once. |
| `r` | Rejects: a box for why (optional), Enter sends. The lane's fail transition is taken. |
| `s` | Sends the work back: a box for what should change, Enter sends. Nothing is sent while it is empty. Not offered for a lane that has not run yet. |
| Enter, on a question | Puts the keyboard in the answer. Type it, Enter sends. Letters typed there are letters. |

The keys work while the keyboard is in the inbox: on an item, or in its decision and proof. On arrival the
keyboard is on the section's name, one Tab before the list, and nothing is chosen for you. A deciding key
pressed there says "Choose an item first" above the list and decides nothing: no key decides on an item you
did not choose. The line goes once you are on an item. An item you entered, from a run's "Decide in the
inbox", a reload or a link, is on show, so the keyboard goes onto it and the keys work at once.

A decision is the command line's own command, started by the server in a process of its own (docs/operations.md).
It is made on the item that is on show and on nothing the run waits on later. After your decision the page
moves to the next item and the keys rest for a moment. When the item you were reading is decided elsewhere,
nothing is chosen until you choose.
When the factory refuses, for example because every slot is busy, its message and its fix are shown.

## Accounts

The logins on this machine: the agent, what each has used in its limits' windows, and whether it is held. Never
where a login is kept. Below, who works each role: choose an account, a model for small, medium and large
lanes and an effort, and Bind. That writes what `softwarefactor role bind` writes. A role that should be on
another vendor than a role it shares one with is flagged. Adding a login stays in the terminal.

The logins come first, a block each between rules: its marks in words after a diamond (near a limit, on hold,
could not be read), then the windows its CLI reports, each with an 8px ink meter on a rule track, the percent
in words beside it and when it resets. A window the CLI does not print is "not reported", never 0. The
factory's own count is shown apart from them. Under 760px these stack, and each role is one block.

## Costs

Tokens and cost by lane, by task and by account, from the session records, with the whole in the top bar. A
session with no known cost is counted as not known, never as nothing. Money is shown in cents (more digits only
under one cent, and the exact figure in a tooltip); `softwarefactor cost` prints the same figures to the
millionth, and `softwarefactor cost --json` the exact ones.

## Plugins

What is built in: lane types, gate types, collectors, agents, and the workflows that come with this version.
Plugins installed in this workspace are named in the sentence under the lists. They are installed from the
terminal with `softwarefactor add` (`docs/plugins.md`), not from the page.

## Keys, and the tab

`g` and then a section's letter goes there from anywhere but a text field: `f` floor, `r` runs, `i` inbox, `a`
accounts, `p` plugins, `c` costs. On the floor, Ctrl or Cmd with Z takes back the last change and with Shift
brings it again, and Revert asks first when more than one change would go. The tab's title is the section with
the number of runs that wait for you in front, then how many work, and its icon carries a yellow mark while
one waits. On Runs and Inbox the first stop of the Tab order is a link, "Skip to the list", that puts the
keyboard on the list instead of after the seven controls of the rail.

## Not built yet

Starting and stopping runs from the interface, adding an account, and installing plugins from the page. A diff is the whole
run's, not one lane's. A screenshot opens at its real size in a new tab, not in a viewer in the page. The rail,
the inspector and the map's labels are sized in pixels: with a larger default font in the browser (not page
zoom) the map's labels crowd.

## How it is checked

`pnpm test` covers the server, the layout and the edits. The screen itself is checked in a real browser by
`bash test/ui/floor.sh` (it needs `playwright-cli` and `pnpm run build`): by keyboard it opens a station, adds a
lane, connects it, follows the change into the JSON view and back, has a save refused, saves, and reads the file.
Give it a folder as its argument and it leaves screenshots there in both themes.
`bash test/ui/floor-phone.sh` checks the floor at 390 wide: the map begins within 160 px of the top, and the
Tools button that folds the floor's controls opens by keyboard.
`bash test/ui/runs.sh` does the same for Runs: it makes three runs with the scripted agent (one done, one
stopped, one waiting), and by key presses alone moves through the list, steps a run back and forth on its map,
and opens the diff, a screenshot pair, a recording, a gate's output and a hand-off.
`bash test/ui/ladder.sh` does the ladder at a lane, and `bash test/ui/restart.sh` a server started again under
a floor that holds a change, and the arrival in the inbox.
`bash test/ui/inbox-proof.sh` checks that order, by keyboard, at both widths. `bash test/ui/inbox.sh` does the inbox, accounts, costs and plugins: it approves, sends work back with a note,
answers a question, has a decision refused, and binds a role, all by key presses.
`bash test/ui/all.sh <folder>` runs all five and leaves a screenshot of every main screen in both themes at
1440 and 390 wide, each checked to be of that screen, in that theme and that wide. At phone width every screen
is walked with the Tab key (each control shown must be reached) and checked not to scroll sideways. It takes
about twelve minutes. The design itself is recorded in `DESIGN.md`, and its palette's contrast is held by
`test/unit/contrast.test.ts`.
