**One P2 defect remains: mean-attack and mean-defense charts are unreadable at phone width. The playback items are closed.**

I made no edits and ran no tests or simulations. I read the files, the saved 390px screenshot from the 12:53 e2e run, and the log showing all three archive specs passed. The archive source files were last modified at 12:53:23, the same time as that run.

## Remaining defects

- **[P2] Mobile mean charts are illegible** (`apps/lab/src/ecosystem/archive.ts:74-85`, `152-179`; `tests/e2e/ecosystem-archive.spec.ts:97-101`).
  - `prepareCanvas` keeps the 760×150 aspect ratio and scales the canvas to the container.
  - At 390px the canvas is about 318 wide and 63 high. With `pad` top 12 and bottom 26, the plot is about 25px tall.
  - The five y labels (`0`–`4`) are drawn at a minimum of 10px, only about 6px apart, so they overprint into one smear.
  - The saved screenshot `runs/ecosystem-library/browser-archive/ecosystem-archive-mobile.png` shows this.
  - The spec only checks that the canvas width is over 300, so it passes.
  - **Fix:** use a minimum canvas height of about 140px on narrow widths. Don't scale it from the aspect ratio. Alternatively, label only 0, 2 and 4 when the plot is under about 60px tall.
  - The population chart on the same screenshot is crowded but legible.

- **[P3] The speed selector can disagree with actual playback after a browser reload or back navigation** (`archive.ts:415`; `apps/lab/ecosystem/archive/index.html:26-31`).
  - `playbackRate` starts at 1, and the `<select>` has no `autocomplete="off"`.
  - The browser can restore "2×" into the select without firing `change`, so the select shows 2× while the videos play at 1×.
  - I did not reproduce this; it is based on how form-state restoration works.
  - **Fix:** add `autocomplete="off"`, or initialise `playbackRate` from the select's value.

- **[P3] The axe run never audits the new trait-data scroller** (`ecosystem-archive.spec.ts:34,102`; `archive.css:4`).
  - The spec closes each trait-data `<details>` before running axe.
  - `.trait-data-table` scrolls (`overflow:auto`, table `min-width:480px`) and has no `tabindex` or `role`/`aria-label`.
  - At 390px that scroller exists but is never checked.
  - **Fix:** add `tabindex="0"`, `role="region"` and an `aria-label`, and run axe with it open.

- **[P3] `check-packaging.py` is not documented.** Nothing in `tools/ecosystem-library/README.md`, `ecosystem-archive/README.md` or `ecosystem-library-validation.md` mentions it. They should say to run it after `pnpm build`.

## Closed findings, checked against current files

- **Retry failure persistence is closed.**
  - The `play` handler no longer removes the video from `playbackFailures`. Only `playing` (`archive.ts:332`) or a fulfilled retry `play()` (`:381`) does.
  - The e2e spec retries while the route is still blocked (`:121-124`) and asserts the global message and retry button persist. It then unroutes and checks recovery (`:126-133`).
- **Deliberate pause is closed.** Pause all, Restart all and hidden-tab all bump `playIntent`, so a pending Play all result is dropped. The retry catch handles `AbortError` too (`:386-392`). A spec covers it with a delayed 1101 route (`:137-150`).
- **Reload speed is closed.** `defaultPlaybackRate` is set in the speed handler and again around `load()` (`:363-375`). The spec asserts 1.5 survives retry (`:132`).
- **Single frame-callback ownership is closed.** The `frameCallbackId` guard (`:310`) prevents a second chain from `seeked` or `play`. A spec counts pending callbacks while seeking during playback (`:48-77`).
- **Textual trajectory data is closed.** Each seed has lazy tabular trait trajectories, and the spec asserts 1005 rows.
- **Provenance hashes are closed.**
  - The manifest hashes the model, four exploration JSONs, `explore.ts`, the sandbox docs, five reviews and `ecosystem.test.ts` (14 files).
  - Copied working files, raw histories, summary and summarizer are checked in `verify.py:209-254`.
  - `verify.py` checks the manifest's model hash and every immutable-base file hash, and rejects a manifest that doesn't pin the model hash.
- **Mock media probes are closed.** `ecosystem-library.test.ts:182-197` covers missing ffprobe, wrong width, frame count, duration and `pix_fmt`. `verify.py:131-160` checks codec, frame rate and start time as well, but no test mocks those three.
- **`pnpm verify:ecosystem`** (`package.json:17`) is a reasonable bounded gate and is not in the default suite, as the plan decided. `replay-3000.ts` requires Node 24 and exits if the model hash differs from the pinned one.

## Limits

- **`check-packaging.py` scope:**
  - It checks built-file names against the Dockerfile `rm -rf` patterns. It is not Docker or Caddy runtime proof, and it doesn't confirm that other pages still work after removal.
  - `fnmatch` `*` also matches `/`, which is looser than shell globbing. This doesn't matter for the flat `assets/` directory.
  - Against the 12:53 `dist` (`ecosystem-*.js`, `-*.css`, `-*.mp4`, `ecosystemArchive*`, `playground-*`) the names match the patterns by inspection.
- **Population chart text:** the population chart has no whole-trajectory table, only the final and 15k–20k range table. I treat that as acceptable, since the earlier review accepted it.
- **Not checked:** I did not re-hash files, run `verify.py`, run the packaging script or run the replay myself.
