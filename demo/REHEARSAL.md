# Rehearsal: how the factory works

Gold example copied: `payout-flow` (a cursorless story of slow arrivals and a held payoff), with the cursor
kept for the two approvals, as `hero-demo` uses it. Everything else is the product's: its style sheets are
imported from `src/ui`, and the map uses its class names.

## What changed from the gold

- The stage is 800 by 352 and carries no window and no plate: the map is drawn on the page's own ground
  (`#ffffff`, `#0d1117`), because a README has no frame to put it in.
- The state steps like the product (a mark, a line, a train move at once). The only fades are the 0.2 s
  entrances of the sentence, the Approve button, the "passed" words and the gates, which the film check asks for.
- The loop ends with the title alone on the page and the next task entering the line, so the seam is clean and the reset has a cause.
- The words are the product's: the run's sentences are those of `src/core/runs/sentence.ts` and `src/ui/RunDetail.tsx`; "Done." is left out, as the product leaves it out. The red return lines and their `fail ×2` tags were dropped: a tag that means "may go back twice" reads as "failed twice" on a run that has not failed.
- The poster is the last step: every lane passed, the run Done. Each WebP file opens on it, held for about a
  second, so a viewer that never animates still sees the result.

## Fresh-eye review

A separate reviewer read the sheets and sources. Fixed after it: the return lines and tags (above), the missing task-enters beat, text sizes raised, the empty lower band (the gates stand from the first frame; a lane's "passed" arrives under its own station when the lane passes), the gates block centred under Build, the sentences taken from the product's own code, a lifted dim line in the dark palette. Not changed: the Approve button sits in the run header though the product offers it in the inbox (the picture merges the run page and the decision bar).

## Checked

- `film.mjs --gate`, 800 wide, light and dark: `rehearsal passed`. Its coverage line says `inconclusive` on this
  machine (sampling gaps of 35 to 40 ms against a 27 ms limit, from the machine's load, not from the page); it
  was `complete` once in dark.
- One loop and the seam at 12 frames a second with the virtual clock; frames read one by one.
- The WebP files, opened in a browser: two screenshots a few seconds apart differ.
- At 390 px wide (the picture scaled to 0.49): the title, the state word, the lane names and the gates read; the
  sentence and the roles under the lane names are small.

## Not checked

- The compact (358 px) design was skipped: a README image is one file that the browser scales, so a second
  design would not be shown. Legibility at 390 px was checked instead (above).
- Reduced motion in a real browser, a touch device, other browsers than Chrome, GitHub's own page.
- Live pacing: the file is rendered frame by frame, so the stage's real-time clock is not what viewers see.
- Type checking of `demo/`: it is outside the root `tsconfig.json`.
