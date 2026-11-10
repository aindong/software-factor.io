---
version: 1
slug: "src-ui-index-html"
primary_target: "src/ui/index.html"
related_targets: []
---

# Surface brief: the Software Factor.io interface (first surface: the factory floor)

Mode: Operate. Scope: the whole local web interface, built in plan tasks 14 to 17, starting with the floor.

## Audience and job

A developer at their desk who runs coding agents daily. Three jobs: lay out a process (unhurried), glance to see
whether anything needs them (two seconds), and decide on one approval with the proof in front of them.

## Task and content

- The floor: build and edit a workflow by placing and wiring lanes. The JSON is one click away.
- Runs: where each task is, what each agent is doing in one sentence, and the evidence.
- Inbox: approvals and questions, each answerable with one key.
- Real content: lane ids and names, gate results with commands and exit codes, diffs, screenshot pairs, tokens,
  cost. All of it is read from the record of real runs. There is no sample data.

## Constraints

Standard web controls. Keyboard for everything. Light and dark. No network at run time (fonts are bundled).
No gradients, no grid of cards, no game art. Decided without an interview: the owner's goal says to decide
without them, so the assigned direction was taken unattended.

## Direction contract

THESIS: A process should read like a network map. The floor is drawn as a transit line diagram: lanes are
stations, transitions are lines, tasks are trains. It refuses the category default of a dark dashboard with a
sidebar and rounded gradient nodes on a dotted canvas.

OWN-WORLD: Map-white ground, navy rail, and four colours with one meaning each: through blue for passed (the
pass route and a passed stop), return vermilion for failed (the fail route, loops and a failed stop), signal
yellow with an ink border only where a person can act, end grey where nothing is happening. Selection and focus
are ink. Lines 6px,
at 0, 45 and 90 degrees only, 12px bends. Stations are ringed white discs, checkpoints are capsules, trains are
numbered capsules. Gates are short end-grey bars on the line. Their results are shown lane by lane in a run,
not by colour on the map. Barlow and Barlow Semi Condensed, system monospace for output. Flat, hairline rules,
no shadow on the map.

STORY: The developer sees their whole process at once, sees where every task is, trusts a result because its
evidence is one click from the station, and acts only where yellow appears.

FIRST VIEWPORT: Left, a 64px navy rail with six sections and the inbox count in yellow. Top bar: workspace,
workflow name, Diagram or JSON switch, run controls. Centre, on white: the workflow as a line diagram, the first
lane at the left, the pass line running right, return lines looping underneath in vermilion, trains at their
stations. Right: a 360px inspector for the selected lane (settings, routes, gates). Bottom: the legend of the
map. As built there is no strip of runs along the bottom: the Runs section is that list, each row with its
strip map. A run that waits is a yellow train on its station, which leads to the inbox. The primary action,
Approve, is in yellow in the inbox.

FORM: Transit line diagram, candidate 3 of 8 on the ordered list (railway signalling panel, process flow
drawing, transit map, inspection tag and manifest, factory-game overlay, lab notebook, departure board,
graphics standards manual). seed:9c417eafefdc7cb6. Signature interaction, as built: entering a run lights the
lines it took on its own map while the rest steps back, and the "Replay" control under that map steps through
the run. Motion, as built: none. A train is drawn at its lane and state steps.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance. DESIGN.md is now the record of what shipped (task 17), with its sidecar in `.impeccable/design.json`.

## Weighed and set aside

- Ticket wallet (evidence as stamped coupons): competitive on clarity for evidence. Kept: nothing disappears, it cancels.
- Orienteering map (run as a numbered course): competitive on clarity. Kept: the run rides above the map and never edits it.
- Warm consumer app: declined. Kept: the bright colour is always something you can press.
- Event catalogue: declined. Kept: density courage, and the map and the list are one space.
- Type specimen: declined. Kept: one control drives a run's map (the "Replay" control).
- Reference manual with acetate leaves: declined. Kept: state steps, it does not fade.

## Unresolved

- Settled in task 14: the diagram is plain SVG with the tool's own layout and routing, not React Flow. The
  workflow file holds no positions, so the map is laid out from the process, and the three angles needed a router
  of our own in any case.
- The honest risk: a transit map is a famous look. It stays a working diagram only if no map furniture is added
  that carries no information.
