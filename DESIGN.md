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
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
  section:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
  data:
    fontFamily: "'Barlow Semi Condensed', Barlow, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.3
  label:
    fontFamily: "'Barlow Semi Condensed', Barlow, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
  rail-label:
    fontFamily: "'Barlow Semi Condensed', Barlow, system-ui, sans-serif"
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
  button-active:
    backgroundColor: "{colors.panel}"
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

This file records the interface as it shipped at the end of plan task 17 (commit ab9d705). Every value here is
read from `src/ui/tokens.css` and the four style sheets beside it. `test/unit/design-record.test.ts` checks the
record against the code, and `test/unit/contrast.test.ts` checks the palette.

The product is a factory you lay out: lanes, the routes between them, and tasks moving through. The interface
draws that floor the way a transit authority draws a network. A lane is a station. A transition is a line. Each
outcome has its own line colour. A task is a small numbered train. A gate is a short bar on the line after its
station. The same notation shrinks into a strip map wherever a run is listed.

The map is white in daylight ("map white") and deep blue at night ("night map"). The theme follows the system
setting, and the button at the foot of the rail switches between Auto, Light and Dark. The world lends type,
palette, density and the diagram. Navigation, layout and controls are the standard ones for a web tool.

**Key Characteristics:**

- One meaning per colour, and a shape for every state.
- Flat like print: panel tone and 1px lines, no shadow on the map.
- Dense: 28px controls and rows, 8px inside a group, 16px between groups.
- State steps. Nothing fades or slides.
- The page keeps to the window. Each part scrolls by itself.

## Colors

Five colours with one meaning each, on cool neutrals that lean towards the blue. All of them are custom
properties in `src/ui/tokens.css`. The dark values are in `:root[data-theme="dark"]` and are repeated under
`@media (prefers-color-scheme: dark)` for a page that has no theme chosen.

| Token | Light (map white) | Dark (night map) | What it is for |
| --- | --- | --- | --- |
| `--ground` | `oklch(98.5% 0.003 240)` | `oklch(19% 0.03 258)` | The map and the content. The fill of a control. |
| `--panel` | `oklch(96% 0.007 240)` | `oklch(23% 0.035 258)` | The inspector, the decision bar, a selected row, a block of output. |
| `--rule` | `oklch(88% 0.01 240)` | `oklch(32% 0.03 258)` | The hairline between things. Never the only border of a live control. |
| `--edge` | `oklch(60% 0.02 250)` | `oklch(58% 0.03 258)` | The border of a control. At least 3:1 on ground and on panel. |
| `--ink` | `oklch(24% 0.035 255)` | `oklch(94% 0.01 240)` | Text, selection, focus, a station's outline, the primary button. |
| `--ink-soft` | `oklch(44% 0.025 255)` | `oklch(74% 0.02 250)` | Secondary text, labels, hints. The border of a control under the pointer. |
| `--rail` | `oklch(27% 0.06 258)` | `oklch(14% 0.03 258)` | The navigation rail. |
| `--rail-active` | `oklch(36% 0.07 258)` | `oklch(27% 0.05 258)` | The current section on the rail. |
| `--rail-ink` | `oklch(98.5% 0.003 240)` | the same | Text and icon of the current section on the rail. |
| `--rail-ink-soft` | `oklch(82% 0.03 250)` | the same | Text and icons of the other sections on the rail. |
| `--through` | `oklch(48% 0.17 255)` | `oklch(70% 0.14 250)` | Passed. |
| `--return` | `oklch(58% 0.2 38)` | `oklch(70% 0.18 40)` | Failed. |
| `--signal` | `oklch(84% 0.17 92)` | the same | A person can act here. |
| `--signal-ink` | `oklch(24% 0.035 255)` | the same | The text and the border on signal yellow. It stays dark at night. |
| `--end` | `oklch(62% 0.012 250)` | `oklch(55% 0.015 250)` | Nothing is happening here. |

### Primary

- **Through blue** (`--through`): passed. The pass line, a passed stop, the "Done" end, a reference the host
  checked.
- **Rail navy** (`--rail`): the navigation rail in both themes. At night it is darker than the ground.

### Secondary

- **Return vermilion** (`--return`): failed. The fail line, a failed stop, the dashed outline of a station the
  workflow points to and does not have, the small diamond that flags a problem.
- **Signal yellow** (`--signal`): a person can act. It always carries a 1.5px ink border (or a 9px ink casing
  under a 6px line), because yellow on white is too faint alone.

### Tertiary

- **End grey** (`--end`): nothing is happening. A line that ends the run, the "Stopped" end, a stop not
  reached, a gate bar, the text of a disabled control.

### Neutral

- **Ground**, **panel**, **rule**, **edge**, **ink** and **ink soft**, as in the table.
- Hover and pressed tones are mixed from the palette with `color-mix`, never written as new colours: the
  primary button is ink mixed with 14% ground under the pointer and 28% when pressed, Approve is signal mixed
  with 12% and 24% ink, a row under the pointer is half panel and half ground, a line a diff put in stands on
  ink at 16%.

### Named Rules

**The One Meaning Rule.** Through blue means passed. Return vermilion means failed. Signal yellow with an ink
border means a person can act. End grey means nothing is happening. Ink is text, selection and focus. None of
them is decoration, a link colour or a highlight. Links are ink, underlined. A diff uses neither blue nor
vermilion.

**The Palette Only Rule.** No colour is written outside `tokens.css`. The style sheets use `var(--name)` and
`color-mix` of those. One exception: the tab's icon in `src/ui/tab.ts` writes the rail's navy and the signal
yellow as plain colours, because an icon cannot read the palette.

**The Yellow Is Yours Rule.** Signal yellow appears only on what a person can act on: the Approve and Answer
buttons and the "Decide in the inbox" link, the rail's count, the mark of a row or lane that waits, the stop
that asked on a strip map, a train that waits, the route that asks a person (on the map, in the legend and in
the inspector), the inbox end station, and the station of a run that asked.

**The Rule And Edge Rule.** `--rule` is the hairline between things. `--edge` is the border of a control and
must be seen: at least 3:1.

**The Contrast Rule.** `test/unit/contrast.test.ts` computes the contrast of the palette in both themes: 4.5:1
for text, 3:1 for shapes and lines. Two things are deliberately not held to it. The text of a disabled control
is end grey. The lines, tags and ends of the workflow step back to opacity 0.28 while a run is drawn over the
map, so the run reads first.

## Typography

**Display Font:** Barlow (with system-ui, sans-serif)
**Body Font:** Barlow (with system-ui, sans-serif)
**Label/Mono Font:** Barlow Semi Condensed for labels and data, the system monospace for code and output

**Character:** One family in two widths. Barlow comes from public signage lettering: plain, even, good
numerals. Barlow Semi Condensed carries station names, labels and numbers, where width is scarce. Code and
command output use the system monospace, because that is what the developer's terminal shows.

The fonts are bundled with the package and load from no network: Barlow at 400, 500 and 600, Barlow Semi
Condensed at 500 and 600, Latin only.

| Token | Value | What it is for |
| --- | --- | --- |
| `--font` | `"Barlow", system-ui, sans-serif` | Body text, headings, controls. |
| `--font-tight` | `"Barlow Semi Condensed", "Barlow", system-ui, sans-serif` | Labels, data, the rail, everything on the map. |
| `--font-code` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | Code, output, the diff, the JSON view. |
| `--text-title` | `1.25rem` | The title of a screen. |
| `--text-section` | `1.0625rem` | A heading inside a screen. |
| `--text-body` | `0.875rem` | Body text and controls. |
| `--text-data` | `0.8125rem` | Data, code, station names. |
| `--text-label` | `0.75rem` | Labels, hints, tags on lines. |

### Hierarchy

- **Title** (600, 1.25rem, 1.2): one per screen, in the top bar.
- **Section** (600, 1.0625rem, 1.2): the heading of the inspector, of a run, of a block on a plain page.
- **Body** (400, 0.875rem, 1.45): text and controls. Running text is held to 62ch to 90ch.
- **Data** (Semi Condensed 500, 0.8125rem, 1.3, tabular numerals): counts, times, tokens, cost, the status
  line. Station names are the same size at 600.
- **Label** (Semi Condensed 600, 0.75rem, 1.2, ink soft): field labels, table heads, the headings of the parts
  of a run, tags on lines. Sentence case, no capitals, no letter-spacing.
- **Rail label** (Semi Condensed 600, 0.6875rem, 1.2): under each icon on the rail, and the rail's count.
- **Code** (monospace 400, 0.8125rem, 1.5): output, the diff, the JSON view, names typed into a file.

### Named Rules

**The Fixed Scale Rule.** Text sizes are in rem and nothing scales with the viewport.

## Layout

The shell is a grid that is exactly as high as the window (`100dvh`). Left, a navy rail 64px wide with the six
sections (Floor, Runs, Inbox, Accounts, Plugins, Costs) and the theme button at its foot. Right, the work
area: a top bar at least 48px high with the title and the screen's controls, then the screen. The rail and the
top bar stay. Each part below scrolls by itself: the map, the inspector, a list, a detail, a plain page. The
page itself never scrolls.

| Token | Value | What it is for |
| --- | --- | --- |
| `--xs` | `4px` | Between a label and its field. |
| `--sm` | `8px` | Inside a group. |
| `--md` | `12px` | The sides of a button. The padding of a screen under 1000px. |
| `--lg` | `16px` | Between groups. The padding of the inspector and the top bar. |
| `--xl` | `24px` | Between the parts of a run or a plain page, and their side padding. |
| `--row` | `28px` | The height of a control and of a table row. It is 40px under 760px. |
| `--control` | `4px` | The radius of a control. |

Widths:

- **Above 1000px.** The floor is the map and a 360px inspector beside it. Runs and Inbox are a list (320px to
  440px) and the detail side by side.
- **Under 1000px.** The inspector becomes a sheet over the lower part of the map, at most 72% of its height,
  opened by one tap on a station or by the "Workflow settings" button, and shut by its Close button. Runs and
  Inbox show one at a time: the list, or the run that was entered, with a button back to the list. In the inbox the
  decision bar moves to the bottom, after the proof.
- **Under 760px.** The rail becomes a bar along the bottom with the sections side by side. Controls are 40px
  high. Tables fit the width: nothing scrolls sideways except the map and a diff.

The map never reflows. It is laid out from the workflow (124px between stations, 28px between tracks) and
scrolls in both directions inside its own box.

### Not built

- **The strip of running runs along the bottom of the floor.** The original direction had one. The Runs
  section is that list. On the floor, "Runs on map" puts a numbered train on the lane of each run that is
  moving or waiting.
- **A time scrubber in that strip.** The scrubber is the "Replay" control under a run's map: a standard range
  input that steps through the run with the arrow keys.
- **Sizes that follow the default font.** The rail, the inspector and the offsets of the map's labels are in
  px. Page zoom works. A larger default font size (not zoom) breaks the map. This is open (critique finding
  F18, declined for this pass).

## Elevation & Depth

Flat, like print. Separation comes from the panel tone and 1px rules. There is one shadow in the system
(`--shadow`): under the inspector when it is a sheet over the map, under 1000px. Stations, trains, buttons and
rows have none.

### Named Rules

**The State Steps Rule.** Nothing fades or slides. The style sheets hold no transition and no animation. A
train is drawn at its lane and Replay moves it one step at a time.

## Shapes

The diagram sets the forms. Lines are 6px thick with round ends, run at 0 and 90 degrees, and turn through a
12px stretch at 45 degrees. A line that is lit or being drawn is 8px. A route taken only on a condition is
dotted and has no arrowhead. Lines of one outcome that lead to the same station run together.

Every state has a shape as well as a colour:

| Shape | Means |
| --- | --- |
| Disc, through blue | Passed. |
| Diamond (a square turned 45 degrees), return vermilion | Failed. |
| Square, signal yellow with a 1.5px ink border | Asks a person. |
| Ring | Not reached. With an ink border: the run is here. |
| Capsule station (40px by 22px) | A person approves here. |
| Short bars across the line after a station (3px by 18px, end grey) | Its gates. |

A station is a ground disc (11px radius) with a 3px ink outline. On a run's map it is filled with the colour
of what the run did there, with a tick or a mark inside. The ends are discs without an outline: "Done" is blue
with a tick, "Stopped" is grey with a bar, the inbox end is yellow with a 1.5px ink outline. A station the
workflow does not have is outlined in dashed vermilion. A station with a problem carries an 8px vermilion
diamond. A train is an ink capsule, 34px by 18px, with the task's number. A train that waits is yellow with an
ink outline.

Every radius the styles use:

| Radius | Where |
| --- | --- |
| 1px | The square mark of a row or lane that asks a person. |
| 1.5px | The gate bar, in the legend and on the map. |
| 3px | The colour swatches of the legend and of the inspector's routes, a key cap (`kbd`), the reference tag of a claim, a name in a list of names. |
| `--control` (4px) | Buttons, fields, selects, the Diagram and JSON switch, the frame of a run's map, a row of proof, a block of output. |
| 6px | The capsule in the legend. |
| 8px | The task's number in a row of Runs or Inbox. |
| 9px | The rail's count. A train on the map has the same corner. |
| 50% | The round state mark. |

### Named Rules

**The Never Colour Alone Rule.** A state is told by its shape and its colour, and a line by its colour, its
label and its end. The table above is the whole vocabulary.

## Components

### Buttons

- **Shape:** gently squared (`--control`, 4px), 28px high, 12px at the sides, text on one line.
- **Quiet (the default):** ground fill, a 1px edge border, ink text. Under the pointer the border is ink soft.
  Pressed, the fill is panel.
- **Primary:** ink fill, ground text, weight 500. Used for Save. Lighter by steps under the pointer and when
  pressed.
- **Approve:** signal yellow, a 1.5px ink border, signal-ink text, weight 600. Only for a person's decision.
  Its key is shown in a small key cap inside the button. While a decision is sent it reads "Approving...".
- **Disabled:** end-grey text, a rule border, and a panel fill where the button had a fill.
- **Focus:** a 2px ink outline, 2px off the control. This is the same for everything that takes focus.

### Inputs / Fields

- **Style:** standard web inputs, selects and textareas. Ground fill, a 1px edge border, 4px radius, 28px high,
  a label above in the label style, a hint below in ink soft.
- **Hover / Focus:** the border goes to ink soft under the pointer. Focus is the ink outline.
- **Read only:** panel fill, ink-soft text.
- **Checkbox and range:** the browser's own, tinted ink with `accent-color`.
- **What is wrong** is said at the field in ink, after an 8px vermilion diamond.

### The Diagram and JSON switch

Two buttons in one 1px edge border. The pressed half is ink with ground text. Its focus outline is drawn
inside, in ground on the pressed half.

### Navigation

The rail: a 20px line icon with a short label under it. Other sections are rail-ink-soft. The current section
is rail-ink on the rail-active block with a 2px rail-ink bar at its left (at its top when the rail is the
bottom bar). The inbox carries the count of what waits: signal yellow, 1.5px signal-ink border, 9px radius.
`g` then a section's letter goes to it. The tab's title carries the same count, and the tab's icon a yellow
mark.

### The Floor: the line diagram, the inspector and the JSON view

Stations, lines, gates and trains as under Shapes. A selected or focused station has a 2px ink ring around
it. Its blue and vermilion handles (5px) appear when it is under the pointer or selected, and a drag from one
draws a new line. The legend under the map names every line and shape and the keys. The inspector is a panel
on the panel tone with a 1px rule at its left, its parts divided by rules. Each route in it carries a small
swatch of its line's colour. The JSON view is the same workflow in one monospace text area on the ground.
Problems are a list, each after a 7px vermilion diamond, with the fix under it in ink soft.

### Runs: the list, the strip map, one run

A row of the list: the state mark, the task's number in an ink capsule (8px radius), the task, when, what it
spent, the strip map, and one sentence. The selected row is on the panel tone. The strip map is 18px high: a
2px rule-coloured line with one stop for each lane (blue disc, vermilion diamond, yellow square with an ink
border, grey ring), and a small outlined capsule around the stop the run is at.

One run: the heading, one sentence, the facts on one line, then its map in a 1px rule frame with the "Replay"
control under it on the panel tone. While a run is drawn over the map, what it did not take steps back to
opacity 0.28. Below, each proof is a row that opens: an edge border when shut, an ink border when open, and
several can be open at once. A reference of a claim is a small tag (3px radius) with a mark that says whether
the host checked it. Output is monospace on the panel tone.

The diff is read by shape. A line put in is weight 600 on a band of ink at 16%. A line taken out has a dashed
ink-soft outline. A file line is weight 700 with an edge line above. Screenshots sit side by side as before
and after, on a small checker of panel and ground so a see-through picture shows its edges.

### Inbox: the decision bar

The same list and detail as Runs. Above the detail is the decision bar on the panel tone: what is asked, the
buttons (Approve or Answer in yellow, the others quiet, each with its key), a box for a note where one is
needed, and what the factory answered in the data style. A refusal is in ink after a vermilion diamond.

### Accounts, Costs and Plugins: plain pages

One scrolling column, 24px between blocks, text held to 72ch. Tables have 28px rows divided by 1px rules,
heads in the label style, numbers right-aligned in tabular numerals, and controls inside a row are standard
fields. The three tables of Costs share their columns. A list of names is a row of small tags (rule border,
3px radius). Under 760px the roles table of Accounts becomes one block per role, each field under its label.

## Do's and Don'ts

### Do:

- **Do** take every colour from `tokens.css`, and mix a hover or pressed tone from those with `color-mix`.
- **Do** give every state a shape as well as a colour, from the table under Shapes.
- **Do** put an ink border (1.5px) or an ink casing on anything signal yellow.
- **Do** border a control with `--edge` and divide things with `--rule`.
- **Do** keep a new screen inside the window: its parts scroll, the page does not.
- **Do** add a pair to `test/unit/contrast.test.ts` when text or a shape lands on a new ground.

### Don't:

- **Don't** use signal yellow on anything a person cannot act on.
- **Don't** use through blue or return vermilion for anything but passed and failed. A diff, a link and a
  highlight are ink.
- **Don't** add a transition or an animation.
- **Don't** add a colour for one screen. Five meanings, five colours.
- **Don't** use gradients, glows or glass as decoration, and don't put a shadow on the map. The one gradient
  in the build is the checker behind a screenshot.
- **Don't** lay content out as a grid of cards.
- **Don't** decorate with map furniture that carries no information: no roundel logos, compass roses or fare
  zones.
- **Don't** use any game's name, art or icons.
