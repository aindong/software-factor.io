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

## Not built yet

Runs on the map, the inbox, accounts, plugins and costs. Each section says so and names the command that gives
the same today. There is no undo beyond Revert, which reloads the file.
