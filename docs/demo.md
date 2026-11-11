# The picture at the top of the README

`docs/media/how-it-works-light.webp` and `how-it-works-dark.webp` are a recording of the real interface. It is the
first run of the starter workflow on the scripted agent: the Floor with the run on the line, Plan working and then
waiting, the Inbox where the plan is approved with the `a` key, Build, Review and Test working on the Floor, the
run waiting at Ship, the second approval, and the run's page with every lane passed. It loops, about 20 seconds,
at 940 by 540 pixels. No real agent runs and nothing costs anything.

Nothing in it is drawn by hand: it is made from `softwarefactor ui` itself, so it follows the design.

## Make it again

```sh
pnpm run build
pnpm run demo:film
```

`demo/film.mjs` makes a scratch project in a temporary folder with its own `FACTOR_HOME` (nothing of yours is
touched), runs `softwarefactor init` there, starts the interface on a free port and has `playwright-cli run-code`
run `demo/capture.js`: it presses the keys of the first run, by keyboard only, and shoots the page about ten
times a second. The frames are put together with `img2webp`, lossless, each held as long as it was on screen,
and written over the two files above. The server and the temporary folders are removed also when it fails. The
frames stay in `demo/frames/<theme>/` (ignored by git) for you to look at. Add `--light` or `--dark` to make one
file, and `--lossy` for a smaller one.

## What it needs

- A build (`pnpm run build`).
- `playwright-cli`, with a browser it can open.
- `img2webp` (from libwebp: `brew install webp`).

It adds nothing to `package.json`.

## What in it is not the product

- The key captions in the top right corner ("g i inbox", "a approve") are added to the page by
  `demo/capture.js` for the film only, because a key press cannot be seen in a recording. The product draws no such
  thing.
- The agent is slowed. Each scripted lane starts with a `sleep` of one second, so that a lane's working state
  (its ring and the running line) can be seen. A real lane takes as long as the agent takes.
- The window is 940 pixels wide. Under 1000 pixels the Floor folds its side panel away, so the whole line, Plan to
  Done, fits and the text still reads when the picture is shown 830 wide. The Inbox then shows an item after
  Enter, as it does on a narrow window.
- The project is `hello-factory`, the one of the quick start, and the two approvals are given by the film's
  script, a moment after the run waits.

## When to record again

After a change to how the Floor, the Inbox or a run's page looks, or to the words on them, or to the keys: run the
command, look at the frames in `demo/frames/` (the first, each approval, a lane working, the last), then at the two
files in a browser. A change to the starter workflow's lanes, or to the keys `g`, `i`, `a`, Tab or Enter, needs an
edit in `demo/capture.js`, which waits on the page's title and presses those keys.

## Embed

The two files are one `<picture>` at the top of [the README](../README.md) and of its translations in
`docs/i18n/`, the dark file for a dark page. The picture has a width and no height, so a narrow page scales it.

## The banner

`docs/media/banner.webp`, the first thing on the README, is a picture and not part of the film. It was made with
the image tool of the Codex CLI from a prompt that asked for the product's navy ground, the wordmark, the line
"A software factory you assemble yourself." and a transit line with five stations, then cut to 1600 by 440 and
saved with `cwebp -q 90`. To replace it, make a new picture of that size on a ground of its own (it has to
stand on a white page and on a dark one) and save it under the same name.

