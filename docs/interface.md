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

## The JSON, one click away

The Diagram and JSON switch shows the same workflow as text. A change in either shows in the other at once.
While the text is not valid JSON the diagram keeps the last version that was, and says so.

Roles, gates, collectors, panels and conditions on a transition are edited in the JSON view. The diagram
draws them.

## Problems

The same checker the command line runs (`softwarefactor check`) runs in the page on every change. Each problem
is listed with its place and its fix, and the station it is about is flagged. Save is off while there is one.
Saving checks again on the server, and writes nothing unless the checker finds nothing.

## What keeps others out

A workflow decides what runs on your machine, so who may save one matters. Two kinds of others can reach a
server on your machine: a page on some other site, which can make your browser send requests to it, and any
other process on the machine, a coding agent included.

- The server listens on 127.0.0.1 only and refuses any request that names another host.
- Every API call must carry a token. The token is given once, in the address the command prints in your
  terminal, after the `#`, where a browser never sends it. The page takes it from there, keeps it for the tab,
  and removes it from the address bar. The page itself holds no token, so asking the server for the page gives
  nothing that opens the API. A tab opened without the key says so.
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

The sentence comes from the record. For an agent at work it is read from the last lines of its CLI's output:
"Build: the agent is running `npm test`." It holds no clock, so it changes only when something happens.

The arrow keys move through the list and Enter goes into a run. A run shows:

- **Its map.** The workflow's diagram, read only, with what the run did at each station and the lines it took
  lit. The Replay control steps through the run with the arrow keys: at each step the map shows the run as it
  was then.
- **What waits for you**, with the command that answers it. Answering from the interface comes with the inbox.
- **The diff** of the whole run, from its base commit to its head. A line taken out is struck through.
- **What its agents attached.** Two images of one lane whose names differ only in the word `before` or `after`
  (`list-before.png`, `list-after.png`) are shown side by side. A `.webm`, `.mp4` or `.mov` plays as a
  recording. Anything else is shown as text or offered as a download.
- **Lane by lane**: the outcome, time, tokens and cost of each visit, its claims with the evidence each names,
  each gate with its command, exit code and output, the hand-off, and what the agent printed.

On the floor, "Runs on map" puts a numbered train on the lane of each run that is moving or waiting. A train
that waits for a person is yellow.

A file of a run is served only when it is a plain file inside that run's own folder under `.factor/runs/`, with
no link on the way, and only as an image, a video, plain text or a download. An `.html` or `.svg` file an agent
attached is shown as its text. It is never run as a page.

## Inbox

The rail shows in yellow how many runs wait for you. The inbox lists them, an approval or a question each, with
the run's map and evidence beside the one that is chosen, so you decide with the proof in view.

| Key | Does |
| --- | --- |
| `a` | Approves. The run goes on at once. |
| `r` | Rejects: a box for why (optional), Enter sends. The lane's fail transition is taken. |
| `s` | Sends the work back: a box for what should change, Enter sends. Nothing is sent while it is empty. Not offered for a lane that has not run yet. |
| Enter, on a question | Puts the keyboard in the answer. Type it, Enter sends. Letters typed there are letters. |

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

## Costs

Tokens and cost by lane, by task and by account, from the session records, with the whole in the top bar. A
session with no known cost is counted as not known, never as nothing. `softwarefactor cost` prints the same.

## Plugins

What is built in: lane types, gate types, collectors, agents, and the workflows that come with this version.
Installing more from a directory is not built yet.

## Not built yet

Starting and stopping runs from the interface, adding an account, and installing plugins. There is no undo on
the floor beyond Revert, which reloads the file. A diff is the whole run's, not one lane's.

## How it is checked

`pnpm test` covers the server, the layout and the edits. The screen itself is checked in a real browser by
`bash test/ui/floor.sh` (it needs `playwright-cli` and `pnpm run build`): by keyboard it opens a station, adds a
lane, connects it, follows the change into the JSON view and back, has a save refused, saves, and reads the file.
Give it a folder as its argument and it leaves screenshots there in both themes.
`bash test/ui/runs.sh` does the same for Runs: it makes three runs with the scripted agent (one done, one
stopped, one waiting), and by key presses alone moves through the list, steps a run back and forth on its map,
and opens the diff, a screenshot pair, a recording, a gate's output and a hand-off.
`bash test/ui/inbox.sh` does the inbox, accounts, costs and plugins: it approves, sends work back with a note,
answers a question, has a decision refused, and binds a role, all by key presses.
