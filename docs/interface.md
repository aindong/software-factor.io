# The interface

```sh
softwarefactor ui            # opens on http://127.0.0.1:4390
softwarefactor ui --port 0   # any free port
```

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

## What keeps another site out

A page on some other site can make your browser send requests to a server on your machine. So the server
listens on 127.0.0.1 only, refuses any request that names another host, and refuses every API call that does
not carry a token which only the page it served holds. It sends no header that lets another origin read its
answers.

## Not built yet

Runs on the map, the inbox, accounts, plugins and costs. Each section says so and names the command that gives
the same today. There is no undo beyond Revert, which reloads the file.
