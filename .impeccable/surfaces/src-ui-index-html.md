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
  cost. Until the engine runs, all of it is sample data and is labelled so.

## Constraints

Standard web controls. Keyboard for everything. Light and dark. No network at run time (fonts are bundled).
No gradients, no grid of cards, no game art. Decided without an interview: the owner's goal says to decide
without them, so the assigned direction was taken unattended.

## Direction contract

THESIS: A process should read like a network map. The floor is drawn as a transit line diagram: lanes are
stations, transitions are lines, tasks are trains. It refuses the category default of a dark dashboard with a
sidebar and rounded gradient nodes on a dotted canvas.

OWN-WORLD: Map-white ground, navy rail, and four colours with one meaning each: through blue for passed (the
pass route and a passed gate), return vermilion for failed (the fail route, loops and a failed gate), signal
yellow with an ink border only where a person can act, end grey where nothing is happening. Selection and focus
are ink. Lines 6px,
at 0, 45 and 90 degrees only, 12px bends. Stations are ringed white discs, checkpoints are capsules, trains are
numbered capsules. Barlow and Barlow Semi Condensed, system monospace for output. Flat, hairline rules, no shadow
on the map.

STORY: The developer sees their whole process at once, sees where every task is, trusts a result because its
evidence is one click from the station, and acts only where yellow appears.

FIRST VIEWPORT: Left, a 64px navy rail with six sections and the inbox count in yellow. Top bar: workspace,
workflow name, Diagram or JSON switch, run controls. Centre, on white: the workflow as a line diagram, the first
lane at the left, the pass line running right, return lines looping underneath in vermilion, trains at their
stations. Right: a 360px inspector for the selected lane (settings, gates, record). Bottom: a strip of runs in
progress, each a strip map. The primary action, Approve, appears in yellow on the station that is waiting and in
the inbox.

FORM: Transit line diagram, candidate 3 of 8 on the ordered list (railway signalling panel, process flow
drawing, transit map, inspection tag and manifest, factory-game overlay, lab notebook, departure board,
graphics standards manual). seed:9c417eafefdc7cb6. Signature interaction: pointing at a run, or focusing it by
keyboard, lights its route on the map, and a time scrubber in the bottom strip replays the run along the lines
once the engine records run events. Motion: trains move at constant speed, state snaps.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Weighed and set aside

- Ticket wallet (evidence as stamped coupons): competitive on clarity for evidence. Kept: nothing disappears, it cancels.
- Orienteering map (run as a numbered course): competitive on clarity. Kept: the run rides above the map and never edits it.
- Warm consumer app: declined. Kept: the bright colour is always something you can press.
- Event catalogue: declined. Kept: density courage, and the map and the list are one space.
- Type specimen: declined. Kept: one control drives the page (the time scrubber).
- Reference manual with acetate leaves: declined. Kept: state steps, it does not fade.

## Unresolved

- Whether React Flow can route edges on the three allowed angles with rounded bends, or needs a custom edge. To be
  proven in task 14 before the rest of the floor is built.
- The honest risk: a transit map is a famous look. It stays a working diagram only if no map furniture is added
  that carries no information.
