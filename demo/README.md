# The README animation (`demo/`)

`docs/media/how-it-works-light.webp` and `how-it-works-dark.webp` show how the factory works: one task, "Say hello",
goes down the five lanes of the starter workflow. Plan works and the run waits for a person; the person approves;
Build works and its three gates (protected, tests kept, verify) are run by the host; Review and Test pass; the run
waits once more before Ship; the person approves; Ship merges and the run is Done. It loops, about 14 seconds.

It is a hand-made illustration, not a recording. Nothing in it runs the product. It is drawn with the product's
own style sheets, so it looks like the floor and a run's map, but its story is written by hand.

## Where things are

| What | Where |
| --- | --- |
| The look: colours, type, marks, lines, stations | `src/ui/*.css`, imported by `demo/main.tsx`. A design change shows in the film without an edit here. |
| The page grounds (GitHub's `#ffffff` and `#0d1117`) | `demo/host.css` |
| The story: steps, words, timing | `demo/Factory.tsx` (`STEPS`, `GATES`, `script`) |
| Where things sit on the stage | `demo/factory.css` |
| Filming and the WebP files | `demo/film.mjs` |
| Copying the stageshow kit | `demo/setup.mjs` |

## Make it again

```sh
pnpm run demo:film
```

This copies the stageshow kit into `demo/.stageshow` (ignored by git), installs what it needs there, steps the
stage's clock frame by frame, shoots one loop in the light and the dark palette and assembles the files with
`img2webp`. Add `--light` or `--dark` after `demo/film.mjs` to make one. Stills of the last frame are in
`demo/.stageshow/stills`.

## What it needs

- The stageshow skill, installed at `$HOME/.claude/skills/stageshow`, or the
  folder named by `STAGESHOW_HOME`. Its kit is MIT licensed, by Benji Taylor. It is copied, never committed, and
  the skill folder is never written to. Its licence is copied with it into `demo/.stageshow/LICENSE`.
- `img2webp` (from libwebp, `brew install webp`), Node 24 and Google Chrome.

## After a design change

1. Run the command and look at the two stills, then at the WebP files in a browser.
2. Check that the words are still true. The words come from the product: lane names and roles from
   `src/core/init.ts`, state words and sentences from `src/ui/words.ts` and the run page, the gate names from the
   starter workflow, "Gates run on the host" from the gate's own tooltip in `src/ui/Diagram.tsx`.
3. A new lane, gate or state needs an edit in `demo/Factory.tsx`: the map is drawn by hand there.
4. To check the film's rules, serve the page with the stageshow copy (`demo/.stageshow/node_modules/.bin/vite
   --config ../vite.config.mjs`) and run `demo/.stageshow/scripts/film.mjs <url> --select '#example' --gate`. It
   must end `rehearsal passed`. `demo/REHEARSAL.md` says what was checked and what was not.

## Embed

The two files are one `<picture>`, the dark one for a dark page. The snippet is in the README.

This guide is in `demo/` and not in `docs/`, because a test requires the README to link every guide in `docs/`.
