# Plan: the Floor's controls at phone width (issue #8)

## Goal

At 390 px wide, the Floor's top bar takes about a third of the screen (the map starts 269 px down on an
844 px window, measured on the current build). Fold the controls that are not needed all the time behind one
button, so the map starts within 160 px of the top and every control can still be reached by keyboard.

## Choices made without asking

- **Where "160 px below the top bar" is measured from.** The Floor's own `.topbar` sits directly on the map
  at every width, so measuring from its bottom edge would always give 0. At phone width the rail is a bar at
  the bottom of the window, so the top of the Floor section (`main.work`) is the top of the window. The check
  measures the top of `.map-scroll` minus the top of its `.work`, and that number must be at most 160.
- **Fold, not one row.** At 390 px there is not room for the title, the workflow picker, the view switch,
  "Runs on map", the three "Add a lane" buttons, the status, Undo, Revert and Save on one row. Making the row
  scroll sideways is not an option: `fits` in `test/ui/keys.sh` forbids sideways scrolling outside the map.
- **What folds and what stays.** These fold: "Workflow settings", the Diagram/JSON switch, "Runs on map" and
  "Add a lane" (Agent, Command, Wait). These stay in view: the title, the workspace name, the workflow picker,
  the status, Undo, Revert (and the Discard/Keep and "Read the file again"/"Save over it" questions that take
  its place), and Save. They stay because the status and Save are what a person reads and uses after every
  change, and the conflict questions must not be hidden.
- **The button.** A `<button>` labelled "Tools", with `aria-expanded` and `aria-controls` pointing at the
  folded group. Enter or Space toggles it. It is shown only under 760 px, the breakpoint `app.css` already
  uses for phones. When opened, the group is a full-width row in the top bar's flow, below the first two rows,
  so it pushes the map down instead of covering it. It stays open until the person closes it. Choosing a
  view or adding a lane does not close it.
- **At or above 761 px nothing changes.** The wrapper of the folded group is `display: contents` there, so the
  controls stay where they are in the flex row now.

## Acceptance criteria

1. Given the full-loop workflow open on the Floor at 390x844 with nothing changed, when the page has loaded,
   then the top of `.map-scroll` is at most 160 px below the top of the Floor section.
2. Given the same page at 390x844 with the controls folded, then the top bar has one button with
   `aria-expanded="false"`, and none of Agent, Command or Wait is a Tab stop. Nothing on the page scrolls
   sideways.
3. Given that page, when the keyboard Tabs to the button with `aria-expanded` in the top bar and presses Enter,
   then `aria-expanded` becomes "true", and "Workflow settings", Diagram, JSON, "Runs on map", Agent, Command
   and Wait are all Tab stops. A walk with the Tab key visits every control that is shown and enabled, and
   nothing scrolls sideways outside the map.
4. Given a change made by keyboard at 390x844 (Agent pressed, instructions typed, sheet closed, the controls
   folded again with Enter), then the map still starts at most 160 px below the top of the Floor section,
   Undo, Revert and Save are Tab stops while the controls are folded, and a Tab walk visits every control that
   is shown and enabled.
5. Given the Floor at 1440x900, then no button in the top bar has `aria-expanded` showing, and Diagram, JSON,
   "Runs on map", Agent, Command and Wait are Tab stops with no button pressed first. The existing floor
   browser check passes, with its phone-width step changed to open the fold before it uses "Workflow settings".
6. Typecheck, lint and the unit and acceptance suites pass.

## Verification contract

- 1: test:test/ui/floor-phone.sh
- 2: test:test/ui/floor-phone.sh
- 3: test:test/ui/floor-phone.sh
- 4: test:test/ui/floor-phone.sh
- 5: cmd:pnpm run build && bash test/ui/floor-phone.sh && bash test/ui/floor.sh
- 6: cmd:pnpm run typecheck && pnpm run lint && pnpm test

`test/ui/floor-phone.sh` needs `playwright-cli` and a build (`pnpm run build`). It is a browser check like
the other files in `test/ui/`, run with `bash`, not by vitest. On the current code it fails at step 2 with
"at phone width: the map begins 269 px below the top of the floor, wanted at most 160". With a throwaway
version of the change described below (built, run, then reverted), the whole check passed and the map started
about 113 px down.

## Files to touch

- `src/ui/Floor.tsx`: a `tools` state (false at first). A "Tools" button with `className="button phone-only"`,
  `aria-expanded={tools}` and `aria-controls="floor-tools"`. A `<div className="tools" id="floor-tools"
  data-open={tools}>` around "Workflow settings", the view switch, "Runs on map" and `<AddLane>`.
- `src/ui/app.css`: `.phone-only` hidden by default (next to `.narrow-only`); `.tools { display: contents }`.
  Under 760 px: `.phone-only` shown; `.tools` a full-width wrapping flex row placed after the other rows
  (`order`); `.tools[data-open="false"] { display: none }`. `display: none` also takes the folded controls
  out of the Tab order.
- `test/ui/floor.sh`: in step 7 (390 wide), before `back_to '^Workflow settings$'`, go to the Tools button and
  press Enter, and fold it again afterwards. No other step runs at 390.
- `test/ui/all.sh`: add `floor-phone` to the list of checks it runs and to the files its "acts by script" grep
  reads.
- `DESIGN.md`: one sentence in the "Under 760px" bullet saying the floor's view, "Runs on map", "Add a lane"
  and "Workflow settings" fold behind a Tools button.
- `docs/interface.md`: one line naming `bash test/ui/floor-phone.sh` next to the other browser checks.
- `test/ui/floor-phone.sh`: the acceptance check, written now and committed with this plan.

## Approach

1. The acceptance check is red on the current code (step 2: 269 px).
2. Add the state, the button and the wrapper in `Floor.tsx`, and the CSS in `app.css`. Build, then run
   `bash test/ui/floor-phone.sh` until it passes.
3. Update the phone step of `test/ui/floor.sh` and run it. Add the new check to `test/ui/all.sh`.
4. Update `DESIGN.md` and `docs/interface.md`.
5. Run the gate: typecheck, lint, tests.

## Done check

- `alleo-verify` (typecheck, lint, vitest)
- `pnpm run build && bash test/ui/floor-phone.sh`, which prints `floor-phone: ok`
- `bash test/ui/floor.sh`, which prints `floor: ok`

## Risks / out of scope

- A long workspace name, or a long refusal in the status ("Not saved: ..."), can add a row to the top bar and
  push the map past 160 px. The check covers the "Saved" and "Not saved" states with a short workspace
  name. Shortening or hiding long text is out of scope: the other checks forbid text that is cut off.
- Between 761 and 1000 px nothing folds. The issue is about phone width.
- No Escape key to close the fold, and no closing it on a click outside. A second press of the button closes
  it.
- The open fold pushes the map down while it is open. That is the cost of not covering the map.
