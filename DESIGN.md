---
name: Software Factor.io
description: The factory floor drawn as a line diagram, so a process reads like a transit map.
colors:
  ground: "oklch(98.5% 0.003 240)"
  panel: "oklch(96% 0.007 240)"
  rule: "oklch(88% 0.01 240)"
  edge: "oklch(60% 0.02 250)"
  ink: "oklch(24% 0.035 255)"
  ink-soft: "oklch(44% 0.025 255)"
  rail: "oklch(27% 0.06 258)"
  rail-active: "oklch(36% 0.07 258)"
  rail-ink: "oklch(98.5% 0.003 240)"
  rail-ink-soft: "oklch(82% 0.03 250)"
  through: "oklch(48% 0.17 255)"
  return: "oklch(58% 0.2 38)"
  signal: "oklch(84% 0.17 92)"
  signal-ink: "oklch(24% 0.035 255)"
  end: "oklch(62% 0.012 250)"
  night-ground: "oklch(19% 0.03 258)"
  night-panel: "oklch(23% 0.035 258)"
  night-rule: "oklch(32% 0.03 258)"
  night-edge: "oklch(58% 0.03 258)"
  night-ink: "oklch(94% 0.01 240)"
  night-ink-soft: "oklch(74% 0.02 250)"
  night-rail: "oklch(14% 0.03 258)"
  night-rail-active: "oklch(27% 0.05 258)"
  night-through: "oklch(70% 0.14 250)"
  night-return: "oklch(70% 0.18 40)"
  night-end: "oklch(55% 0.015 250)"
typography:
  title:
    fontFamily: "'Atkinson Hyperlegible Next', system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
  section:
    fontFamily: "'Atkinson Hyperlegible Next', system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "'Atkinson Hyperlegible Next', system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "'Atkinson Hyperlegible Next', system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.3
  label:
    fontFamily: "'Atkinson Hyperlegible Next', system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.2
  rail-label:
    fontFamily: "'Barlow Semi Condensed', system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  asked-mark: "1px"
  gate-bar: "1.5px"
  tag: "3px"
  control: "4px"
  legend-capsule: "6px"
  task-number: "8px"
  count: "9px"
  disc: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  row: "28px"
components:
  button:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "{spacing.row}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "{spacing.row}"
  button-approve:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "{spacing.row}"
  button-disabled:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.end}"
  field:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "2px 8px"
    height: "{spacing.row}"
  switch-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
  nav-rail:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.rail-ink-soft}"
    typography: "{typography.rail-label}"
    width: "64px"
  nav-rail-current:
    backgroundColor: "{colors.rail-active}"
    textColor: "{colors.rail-ink}"
  rail-count:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.count}"
    padding: "0 4px"
---

# Design System: Software Factor.io

## Overview

**Creative North Star: "The Line Diagram"**

The record of what shipped. The signature move: the line diagram. Every value is read from `src/ui/tokens.css`
and the style sheets beside it. `test/unit/design-record.test.ts` checks it against the code.

The floor is drawn the way a transit authority draws a network. A lane is a station, a transition is a line,
each outcome has its own line colour, a task is a numbered train, a gate is a short bar on the line after its
station. The same notation shrinks into a strip map wherever a run is listed. The map is white by day and deep blue at night. The theme follows the system; the rail's foot button switches Auto, Light, Dark.

**Key Characteristics:**

- One meaning per colour, and a shape for every state.
- Flat like print.
- Dense: 28px controls and rows, 8px inside a group, 16px between groups.
- State steps.
- The page keeps to the window.

## Colors

Five colours with one meaning each, on cool neutrals. The dark values are in `:root[data-theme="dark"]`,
repeated under `@media (prefers-color-scheme: dark)`.

| Token | Light (map white) | Dark (night map) | What it is for |
| --- | --- | --- | --- |
| `--ground` | `oklch(98.5% 0.003 240)` | `oklch(19% 0.03 258)` | The map and the content. The fill of a control. |
| `--panel` | `oklch(96% 0.007 240)` | `oklch(23% 0.035 258)` | The inspector, the decision bar, a selected row, output. |
| `--rule` | `oklch(88% 0.01 240)` | `oklch(32% 0.03 258)` | The hairline between things. |
| `--edge` | `oklch(60% 0.02 250)` | `oklch(58% 0.03 258)` | The border of a control. |
| `--ink` | `oklch(24% 0.035 255)` | `oklch(94% 0.01 240)` | Text, selection, focus, a station's outline, the primary button. |
| `--ink-soft` | `oklch(44% 0.025 255)` | `oklch(74% 0.02 250)` | Secondary text, labels, hints. A control's border under the pointer. |
| `--rail` | `oklch(27% 0.06 258)` | `oklch(14% 0.03 258)` | The navigation rail. At night it is darker than the ground. |
| `--rail-active` | `oklch(36% 0.07 258)` | `oklch(27% 0.05 258)` | The current section on the rail. |
| `--rail-ink` | `oklch(98.5% 0.003 240)` | the same | The current section's text and icon. |
| `--rail-ink-soft` | `oklch(82% 0.03 250)` | the same | The other sections' text and icons. |
| `--through` | `oklch(48% 0.17 255)` | `oklch(70% 0.14 250)` | Passed: the pass line, a passed stop, the "Done" end, a reference the host checked. |
| `--return` | `oklch(58% 0.2 38)` | `oklch(70% 0.18 40)` | Failed: the fail line, a failed stop, the dashed outline of a station the workflow lacks, the diamond that flags a problem. |
| `--signal` | `oklch(84% 0.17 92)` | the same | A person can act here. Always with a 1.5px ink border, or a 9px ink casing under a 6px line: yellow on white is too faint alone. |
| `--signal-ink` | `oklch(24% 0.035 255)` | the same | Text and border on signal yellow. It stays dark at night. |
| `--end` | `oklch(62% 0.012 250)` | `oklch(55% 0.015 250)` | Nothing is happening: a line that ends the run, the "Stopped" end, a stop not reached, a gate bar, a disabled control's text. |

### Neutral

- Hover and pressed tones are mixed from the palette with `color-mix`: the primary button is ink with 14%
  ground under the pointer and 28% pressed, Approve is signal with 12% and 24% ink, a row under the pointer is
  half panel and half ground, a line a diff put in stands on ink at 16%.

### Named Rules

**The One Meaning Rule.** Through blue = passed. Return vermilion = failed. Signal yellow with an ink border =
a person can act. End grey = nothing is happening. Ink = text, selection and focus. None is decoration, a link colour or a highlight. Links are ink, underlined. A diff uses neither blue nor vermilion.

**The Palette Only Rule.** No colour is written outside `tokens.css`. One exception: the tab's icon in
`src/ui/tab.ts` writes the rail's navy and the signal yellow as plain colours, because an icon cannot read the
palette.

**The Yellow Is Yours Rule.** Signal yellow appears only on what a person can act on: the Approve and Answer
buttons and the "Decide in the inbox" link, the rail's count, the mark of a row or lane that waits, the stop
that asked on a strip map, a train that waits, the route that asks a person (on the map, in the legend and in
the inspector), the inbox end station, and the station of a run that asked.

**The Rule And Edge Rule.** `--rule` is the hairline between things. `--edge` is the border of a control and
must be seen: at least 3:1 on ground and on panel.

**The Contrast Rule.** `test/unit/contrast.test.ts` holds the palette in both themes to 4.5:1 for text and 3:1
for shapes and lines. Two things are deliberately not held to it: the text of a disabled control (end grey),
and the lines and end marks that step back to opacity 0.28 while a run is drawn over the map. Their labels turn end grey, which still reads at 3 to 1.

## Typography

**Display and Body Font:** Atkinson Hyperlegible Next
**Label/Mono Font:** Barlow Semi Condensed for the rail and map, system monospace for output

**Character:** Atkinson Hyperlegible Next was drawn for low vision: open shapes, tall x-height. Barlow Semi Condensed stays for the rail and the map, which are short of width. Both are bundled and
load from no network: Latin only.

| Token | Value | What it is for |
| --- | --- | --- |
| `--font` | `"Atkinson Hyperlegible Next", system-ui, sans-serif` | Text, labels and data. |
| `--font-tight` | `"Barlow Semi Condensed", system-ui, sans-serif` | The rail and everything on the map. |
| `--font-code` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | Output, the diff, the JSON view, names typed into a file. |
| `--text-title` | `1.25rem` | Title (600, line 1.2): one per screen, in the top bar. |
| `--text-section` | `1.125rem` | Section (600, line 1.2): the heading of the inspector, a run, a block of a page. |
| `--text-body` | `0.9375rem` | Body (400, line 1.5): text and controls. Running text: 62ch to 70ch. |
| `--text-data` | `0.875rem` | Data (500, line 1.3, tabular numerals), station names (Semi Condensed 600), code (400, line 1.5). |
| `--text-label` | `0.8125rem` | Label (600, line 1.2, ink soft): field labels, table heads, tags on lines. |

The rail's labels and count are Semi Condensed 600 at 0.6875rem, with no token.
Labels are in sentence case, not letter-spaced.

### Named Rules

**The Fixed Scale Rule.** Text sizes are in rem and nothing scales with the viewport.

## Layout

The shell is exactly as high as the window (`100dvh`). Left, a navy rail 64px wide with the six sections
(Floor, Runs, Inbox, Accounts, Plugins, Costs) and the theme button at its foot. Right, a top bar at least 48px
high, then the screen. The rail and the top bar stay. Each part scrolls by itself: the map, the inspector, a
list, a detail, a plain page. The page never scrolls.

| Token | Value | What it is for |
| --- | --- | --- |
| `--xs` | `4px` | Between a label and its field. |
| `--sm` | `8px` | Inside a group. |
| `--md` | `12px` | The sides of a button. The padding of a screen under 1000px. |
| `--lg` | `16px` | Between groups. The padding of the inspector and the top bar. |
| `--xl` | `24px` | Between the parts of a run or a page, and their side padding. |
| `--row` | `28px` | The height of a control and of a table row. 44px under 760px. |
| `--control` | `4px` | The radius of a control. |

- **Above 1000px.** The floor is the map with a 360px inspector beside it. Runs and Inbox are a list (320px to
  440px) and the detail side by side.
- **Under 1000px.** The inspector is a sheet over the lower part of the map, at most half of its height, opened
  by one tap on a station or by the "Workflow settings" button, shut by its Close button. Runs and Inbox show
  one at a time: the list, or the run that was entered, with a button back to the list. The inbox's decision
  bar moves to the bottom, after the proof.
- **Under 760px.** The rail is a bar along the bottom. Controls are 44px high. Tables fit the width: nothing scrolls
  sideways but the map and a diff.

The map never reflows: it is laid out from the workflow (124px between stations, 28px between tracks) and
scrolls both ways in its own box. A run's map, which is only read, is drawn smaller to fit its box, down to
seven tenths of its size, and scrolls after that.

### Not built

- **The strip of running runs along the bottom of the floor.** The Runs section is that list, and "Runs on map"
  puts a numbered train on the lane of each working or waiting run.
- **A time scrubber in that strip.** It is the "Replay" range input under a run's map.
- **Sizes that follow the default font.** The rail, the inspector and the map's label offsets are in px. Page zoom
  works; a larger default font breaks the map.

## Elevation & Depth

Flat, like print: panel tone and 1px rules. The one shadow (`--shadow`) is under the inspector when it is a sheet. Nothing else has one.

### Named Rules

**The State Steps Rule.** Motion has one meaning: work is going on right now, in a lane an agent or a gate is
working in. Only that moves, slowly and a little (`transform`, `opacity`, `stroke-dashoffset`). Every other
change is a step: nothing fades or slides, and no style sheet holds a transition. Each animation is named
`at-work-…` and sits in `working.css` inside `@media (prefers-reduced-motion: no-preference)`; under reduced
motion the same mark stands still. A run that waits, is stopped or is done does not move; Replay steps a train.

## Shapes

Lines are 6px thick with round ends, run at 0 and 90 degrees, and turn through a 12px stretch at 45 degrees. A
line that is lit or being drawn is 8px. A route taken only on a condition is dotted and has no arrowhead.
Lines of one outcome that lead to the same station run together.

| Shape | Means |
| --- | --- |
| Disc, through blue | Passed. |
| Diamond, return vermilion | Failed. |
| Square, signal yellow with a 1.5px ink border | Asks a person. |
| Ring | Not reached. With an ink border: the run is here. |
| Capsule station (40px by 22px) | A person approves here. |
| Short bars across the line after a station (3px by 18px, end grey) | Its gates. |

A station is a ground disc (11px radius) with a 3px ink outline. On a run's map it is filled with the colour
of what the run did there, with a mark inside. The ends have no outline: "Done" is blue with a tick, "Stopped"
is grey with a bar, the inbox end is yellow with a 1.5px ink outline. A station the workflow lacks is outlined
in dashed vermilion. One with a problem carries an 8px vermilion diamond. A train is an ink capsule, 34px by
18px, with the task's number. A train that waits is yellow with an ink outline. Where work is going on, the station has a thin ink ring that
breathes, and the line the task came along has 2px ground dashes that run the way it goes. A
working run's mark is a ring with a dot, and the rail's Runs item carries it while any run works.

| Radius | Where |
| --- | --- |
| 1px | The square mark of a row or lane that asks a person. |
| 1.5px | The gate bar, in the legend and on the map. |
| 3px | The swatches of the legend and of the inspector's routes, a key cap, a claim's reference tag, a name in a list. |
| `--control` (4px) | Buttons, fields, selects, the Diagram and JSON switch, the frame of a run's map, a row of proof, output. |
| 6px | The capsule in the legend. |
| 8px | The task's number in a row of Runs or Inbox. |
| 9px | The rail's count. A train on the map has the same corner. |
| 50% | The round state mark. |

### Named Rules

**The Never Colour Alone Rule.** A state is told by its shape and its colour, and a line by its colour, its
label and its end.

## Components

### Buttons

- **Shape:** `--control` radius, `--row` high, 12px at the sides, text on one line.
- **Quiet (the default):** ground fill, 1px edge border, ink text. Under the pointer the border is ink soft.
  Pressed, the fill is panel.
- **Primary:** ink fill, ground text, weight 500. Used for Save.
- **Approve:** signal yellow, 1.5px ink border, signal-ink text, weight 600, its key in a small key cap. While
  a decision is sent it reads "Approving...".
- **Disabled:** end-grey text, a rule border, and a panel fill where the button had a fill.
- **Focus:** a 2px ink outline, 2px off. The same for everything that takes focus.

### Inputs / Fields

- **Style:** standard inputs, selects and textareas, bordered, sized and focused like a quiet button, with a
  label above and a hint below in ink soft. Read only: panel fill, ink-soft text.
- **Checkbox and range:** the browser's own, tinted ink with `accent-color`.
- **What is wrong** is said at the field in ink, after an 8px vermilion diamond.
- **The Diagram and JSON switch:** two buttons in one 1px edge border. The pressed half is ink with ground
  text, and its focus outline is drawn inside in ground.

### Navigation

A 20px line icon with a label under it. Other sections are rail-ink-soft. The current one is rail-ink on the
rail-active block with a 2px rail-ink bar at its left (at its top on the bottom bar). The inbox carries the
count of what waits: signal yellow, 1.5px signal-ink border, 9px radius. `g` then a section's letter goes to
it. The tab's title carries the count and how many work; its icon, a yellow mark.

### The Floor: the line diagram, the inspector and the JSON view

A selected or focused station has a 2px ink ring. Its blue and vermilion handles (5px) show when it is under
the pointer or selected, and a drag from one draws a new line. The legend under the map names every line, shape and key. The inspector is on the panel tone with a 1px rule at its left, its parts divided by rules, and
each route in it carries a swatch of its line's colour. The JSON view is one text area on the ground. Problems are a list, each after a 7px vermilion diamond, with the fix under it in ink soft.

### Runs: the list, the strip map, one run

A row: the state mark, the task's number in an ink capsule, the task, when, what it spent, the strip map, one
sentence. The selected row is on the panel tone. The strip map is 18px high: a 2px rule-coloured line with one
stop for each lane, and a small outlined capsule around the stop the run is at.

One run: the heading, one sentence, the facts on one line, then its map in a 1px rule frame with "Replay"
under it on the panel tone. Each proof is a row that opens: an edge border shut, an ink border open, several
at once. A claim's reference is a small tag with a mark that says whether the host checked it. Output is on
the panel tone.

The diff is read by shape. A line put in is weight 600 on a band of ink at 16%. A line taken out has a dashed
ink-soft outline. A file line is weight 700 with an edge line above. Screenshots sit side by side as before
and after, on a checker of panel and ground so a see-through picture shows its edges.

### Inbox: the decision bar

The list and detail of Runs. Above the detail, on the panel tone: what is asked, the buttons (Approve or
Answer in yellow, the others quiet, each with its key), a box for a note where needed, and what the factory
answered in the data style. A refusal is in ink after a vermilion diamond.

### Accounts, Costs and Plugins: plain pages

One scrolling column, 24px between blocks, text held to 72ch. Tables have 28px rows divided by 1px rules,
heads in the label style, numbers right-aligned in tabular numerals. The three Costs tables share their
columns. A list of names is a row of small tags (rule border, 3px radius). Accounts draws logins' limits as meters.
Under 760px its roles are a block each, each field under its label.

## Do's and Don'ts

### Do:

- **Do** keep the named rules above. They are tested.
- **Do** keep a new screen inside the window: its parts scroll, the page does not.
- **Do** add a pair to `test/unit/contrast.test.ts` when text or a shape lands on a new ground.

### Don't:

- **Don't** add a colour for one screen. Five meanings, five colours.
- **Don't** use gradients, glows or glass as decoration, and don't put a shadow on the map. The only gradient is
  the checker behind a screenshot.
- **Don't** lay content out as a grid of cards.
- **Don't** decorate with map furniture that carries no information: no roundel logos, compass roses or fare
  zones.
- **Don't** use any game's name, art or icons.
