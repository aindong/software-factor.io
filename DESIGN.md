---
name: Software Factor.io
description: The factory floor drawn as a line diagram, so a process reads like a transit map.
colors:
  map-white: "oklch(98.5% 0.003 240)"
  panel: "oklch(96% 0.007 240)"
  rule: "oklch(88% 0.01 240)"
  ink: "oklch(24% 0.035 255)"
  ink-soft: "oklch(48% 0.025 255)"
  rail: "oklch(27% 0.06 258)"
  rail-active: "oklch(36% 0.07 258)"
  line-through: "oklch(48% 0.17 255)"
  line-return: "oklch(62% 0.2 38)"
  signal: "oklch(84% 0.17 92)"
  line-end: "oklch(62% 0.012 250)"
  night-ground: "oklch(19% 0.03 258)"
  night-panel: "oklch(23% 0.035 258)"
  night-rule: "oklch(32% 0.03 258)"
  night-ink: "oklch(94% 0.01 240)"
  night-ink-soft: "oklch(72% 0.02 250)"
  night-rail: "oklch(14% 0.03 258)"
  night-rail-active: "oklch(27% 0.05 258)"
  night-line-through: "oklch(70% 0.14 250)"
  night-line-return: "oklch(70% 0.18 40)"
  night-line-end: "oklch(55% 0.015 250)"
typography:
  body:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "'Barlow Semi Condensed', Barlow, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
  data:
    fontFamily: "'Barlow Semi Condensed', Barlow, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.3
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: "4px"
  bend: "12px"
  station: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.map-white}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-approve:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-quiet:
    backgroundColor: "{colors.map-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  nav-rail:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.map-white}"
    width: "64px"
---

# Design System: Software Factor.io

## Overview

**Status: the direction, written on 2026-11-10 before any screen exists.** It records the choice so the build has
one target. The values are starting values. When the interface is built and reviewed (plan task 17), this file is
rewritten from what shipped. The development contract for the first surface is in
`.impeccable/surfaces/src-ui-index-html.md`.

The product is a factory you lay out: lanes, the routes between them, and tasks moving through. The interface
draws that floor the way a transit authority draws a network. A lane is a station. A transition is a line. Each
outcome has its own line colour. A task is a small numbered train. A gate is a barrier before the platform exit.
A developer who has read one underground map already knows how to read their process.

The scene that decides light and dark: a developer at a desk in daylight, this tab parked beside a dark terminal
and editor, glanced at between other work. So the map is white, like the printed diagram, and it is the brightest
thing on the desk only when it needs to be. In the evening the same tab under a lamp becomes the night map: a
deep blue ground with the lines lit.

The world lends four things and no more: type, palette, density, and one signature move. Navigation, layout and
controls are the standard ones for a web tool.

**The signature move: the line diagram.** The workflow is drawn with a transit map's rules, and the same notation
shrinks into a strip map (the one-line diagram above a carriage door) wherever a run is listed.

Raises taken from the directions this one was weighed against:

- **From the ticket wallet: nothing disappears, it cancels.** A superseded gate result or a rejected hand-off
  stays in the record, struck through. It is never removed.
- **From the orienteering map: the course rides above the terrain and never edits it.** The workflow is the fixed
  layer. A run is an overlay drawn on top, which can be switched off.
- **From the consumer app: the bright colour is always something you can press.** Signal yellow appears only
  where a person can act.
- **From the event catalogue: density courage, and the map and the list are one space.** Every run is a compact
  row with its strip map, and pointing at a row lights its route on the diagram.
- **From the type specimen: one control drives the page.** A time scrubber replays any run across the whole floor.
- **From the reference manual: state steps, it does not fade.**

Alternates kept on record: evidence as stamped travel coupons (competitive on clarity for the evidence viewer),
and an orienteering map with the run as a numbered course (competitive on clarity). The owner can ask for either.

## Colors

Strategy: a full palette where every colour has a job. A screen of grey with one accent would be the category
default.

### Primary

- **Through blue** (`line-through`): passed. The route a task takes when a lane passes, a gate that passed, and
  evidence that checks out. Nothing else is blue.
- **Rail navy** (`rail`): the navigation rail. The shell is committed to it in both themes, darker than the
  ground at night (`night-rail`). The current section sits on `rail-active`.

### Secondary

- **Return vermilion** (`line-return`): failed. The route a task takes when a lane fails, a loop back to an
  earlier lane, and a gate that failed.
- **Signal yellow** (`signal`): a person can act here: an approval, a question, the inbox count. Yellow on white
  is too faint to see on its own, so every yellow shape carries a 1.5px ink border and ink text.

### Tertiary

- **End grey** (`line-end`): nothing is happening here. Routes to `@stop` and `@drop`, a lane no run has reached,
  a disabled control.

### Neutral

- **Map white** (`map-white`) for the diagram and content, **panel** for inspectors and toolbars, **rule** for
  hairlines, **ink** for text, **ink soft** for secondary text. The neutrals lean cool, towards the blue.
- Night map: `night-ground`, `night-panel`, `night-rule`, `night-ink`, `night-ink-soft`, with the lines at their
  `night-` values. Signal yellow is the same in both.
- Selection and keyboard focus are ink (night ink at night): a 2px ring, offset. They are never a line colour, so
  a selected failed station is still plainly vermilion.

### Named Rules

- **One meaning per colour.** Blue means passed, vermilion means failed, yellow means a person can act, grey
  means nothing is happening. None of them is ever decoration, a link colour or a highlight. Links are ink,
  underlined.
- **Never colour alone.** Each line also differs by its end marker and label, and each state by its shape.

## Typography

One family in two widths. Barlow comes from public signage lettering, which is the right voice for a map: plain,
even, good numerals. Barlow Semi Condensed carries station labels, table cells and numbers, where width is scarce.
Code and command output use the system monospace, because that is what the developer's terminal shows.

The build must bundle the fonts with the package (nothing is installed yet). The tool runs on one machine and
must work with no network.

### Hierarchy

- Title 20px, semibold. One per screen.
- Section 17px, semibold.
- Body 14px.
- Label 12px Semi Condensed, semibold. Sentence case, not capitals, not letter-spaced.
- Data 13px Semi Condensed, medium, tabular numerals.
- Code 13px monospace.

A fixed scale in rem, ratio about 1.2. Nothing scales with the viewport.

## Layout

The shell, left to right: a 64px navy rail (Floor, Runs, Inbox, Accounts, Plugins, Costs), then the work area
with a top bar (workspace, workflow, a Diagram or JSON switch, run controls), then a 360px inspector for whatever
is selected. A strip along the bottom lists what is running now, each run as a strip map. The top bar holds a
"Runs on map" switch for the run overlay. The bottom strip's header holds the time scrubber for the selected run.

Dense, like a map legend: 28px rows, 8px gaps inside groups, 16px between groups.

Narrow screens: the inspector becomes a sheet over the map, the rail becomes a bottom bar, the diagram scrolls in
both directions and never reflows.

## Elevation & Depth

Flat, like print. Separation comes from the panel tone and 1px rules. The one shadow in the system is under a
popover or sheet that covers the map. Stations and trains have no shadow.

## Shapes

The diagram sets the forms. Lines are 6px thick and run only at 0, 45 and 90 degrees, with a 12px radius at each
bend. A station is a white disc with a 3px ink ring. A lane with a checkpoint is a longer interchange capsule. A
train is a small capsule in the line's colour with the task number in it. A gate is a short bar across the line
before the station's exit: grey when it has not run, blue with a tick when passed, vermilion with a cross when
failed.

Controls have a 4px radius, the inbox count included. Nothing is fully rounded except stations and trains.

## Components

### Buttons

Primary is an ink fill with white text. Approve is signal yellow with an ink border and ink text, and appears
only for a person's decision. Quiet is white with a rule border. Each has hover, focus (a 2px ink ring, offset),
active, disabled and busy states.

### Inputs / Fields

Standard web controls, 28px high, rule border, ink focus ring. No custom select or scrollbar.

### Navigation

The rail: an icon with a short label under it, the current item on the `rail-active` block with a white edge.
The inbox count is a signal-yellow block with ink text. `g` then a letter jumps between sections.

### The line diagram

Stations, lines, gates and trains as described under Shapes. Selecting a station opens it in the inspector.
Dragging from a station's exit draws a new line, which snaps to the allowed angles. By keyboard: arrow keys move
between stations along the lines, Enter opens one, and `c` opens a standard list of lanes to connect it to, with
the outcome chosen in the same list. The JSON view shows the same workflow as text, and a change in either
updates the other.

### The strip map

One run on one line: its stations in order, filled up to where the task is, the current one ringed, a vermilion
tick where a round went back. It fits in a 28px table row. Pointing at a row, or moving keyboard focus to it,
lights that run's route on the diagram.

### The run overlay and the time scrubber

A run is drawn over the workflow and never changes it. The "Runs on map" switch in the top bar turns the overlay
off, leaving the bare workflow for editing. The scrubber is a standard range input in the bottom strip's header:
dragging it, or the left and right arrow keys, replays the selected run along its lines. It needs the events the
engine records for each run, so it appears only for runs that have them.

### The evidence panel

For a selected gate or claim: the command, the exit code, the tree it ran on, and the output in monospace.
Screenshots sit side by side as before and after. A superseded result is struck through, not removed.

### Motion

A train moves along its line at a constant speed, up to 200ms a hop. State changes snap. With reduced motion,
trains jump and nothing else moves.

## Do's and Don'ts

### Do:

- Keep every line on the three allowed angles.
- Label a station with its lane's name, in sentence case, beside it and never on top of a line.
- Show sample data as sample data until real runs exist.
- Give every state a shape as well as a colour.

### Don't:

- Don't use gradients, glows or glass.
- Don't add a colour for one screen. Five meanings, five colours.
- Don't lay content out as a grid of cards.
- Don't decorate with map furniture: no roundel logos, compass roses or fare zones that carry no information.
- Don't use yellow for anything a person cannot act on.
- Don't use any game's name, art or icons.
