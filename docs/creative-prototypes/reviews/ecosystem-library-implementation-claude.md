I made no edits and ran no simulations. Another editor was changing the archive files while I reviewed, so I pinned this to `archive.ts` 12:43:45, `archive/index.html` 12:43:59 and `ecosystem-archive.spec.ts` 12:43:53, with `verify.py` last modified 12:40:10. I did not run any test suite or the build; the packaging check below compares the Docker globs against the existing `apps/lab/dist` names.

**Findings, most important first**

1. **The 3,000-tick model parity check is not automated.**
   - Only the Node 24 script `tools/ecosystem-library/replay-3000.ts` compares the transplanted model with the staged v4 exploration censuses.
   - `apps/lab/test/ecosystem.test.ts` is byte-identical to the original and doesn't mention tick 3000 or "staged".
   - `verify.py` only compares the raw records with the staged data, so it never exercises the model.
   - The plan lists "three-seed 3,000 census parity" as a test, but nothing in `pnpm test` runs it.

2. **Provenance hashes cover only part of the copied set.**
   - `provenance.json` and `verify.py` guard the model, four exploration JSONs and `explore.ts`.
   - Eight other files copied from f1f98f39 are not hashed: `docs/ecosystem-sandbox.md`, `docs/ecosystem-sandbox-plan.md`, five review files and `apps/lab/test/ecosystem.test.ts`.
   - I checked them by hand and they are byte-identical today, but nothing would catch a later change.

3. **Retry does more than reload (`archive.ts:283-296`, `340-343`).**
   - `video.load()` resets `playbackRate` to 1 and the position to 0, while the speed selector still shows the old value. Setting `defaultPlaybackRate` in the speed handler would fix this.
   - Retry also calls `play()`, so a click on a no-autoplay page starts motion.
   - If the reload fails again, the `error` handler and the `play()` rejection both write the status text. The result can say "Playback could not start" for what was a load failure.

4. **Play all followed by Pause all or a hidden tab shows a false failure (`archive.ts:313-326`).**
   - If the user pauses before `play()` settles (likely with `preload="metadata"`), it rejects with `AbortError` and is counted as a start failure.
   - `renderPlaybackStatus` shows failures ahead of the "paused" notice. The message "Playback could not start for N recordings" then stays until a `play` event.
   - Separately, the "paused while hidden" message is set even when nothing was playing, and it is still there after return.

5. **Mobile chart text is not readable.**
   - The canvases are fixed at 760px wide with 10–11px text and CSS `width:100%`. At a 390px viewport that scales the labels to roughly 4–5px.
   - The e2e spec checks only horizontal overflow and axe, so it would not catch this.

6. **The attack and defense mean trajectories have no text alternative.** They have only an `aria-label` on the canvas. The population chart has a family table and the final bins have tables. The plan says "no image-only data claims", so this is your call.

7. **The verifier tests don't match the plan's shape.**
   - They cover the raw-history validators, the hash check and the summary comparison.
   - They never touch ffprobe: no test for the "ffprobe is required" failure or for a wrong size, frame count or duration, and no mock probes.
   - They don't run `verify()` end to end.
   - `verify.py` doesn't check `pix_fmt`.
   - The seed 1103 text (Hunter gone at tick 640, Jade at 1,740) is hard-coded in the HTML. It matches the notices and censuses today, but no test guards it.

8. **Smaller items.**
   - `play` and `seeked` each start a self-rescheduling `showFrame` chain, so every seek during playback adds one (`archive.ts:260-278`).
   - `ecosystem-library-packaging.test.ts` only string-matches the Dockerfile and Caddyfile, like the sibling packaging tests. No committed test runs the removal against built output.
   - The Docker globs do match the names already in `apps/lab/dist` (`ecosystem-*.js/css/mp4`, `ecosystemArchive*`, `playground-*`).
   - `backlog-status.md` reads "currents spatial," and is missing a comma.

**Checked and fine**
- **Model:** the model SHA is `71b8cc9c…`, identical to f1f98f39. The other copied docs, tests and tools are byte-identical, except the four UI files you meant to change.
- **Live page:** `main.ts` differs only in starting paused and pausing on hidden, with no catch-up on return.
- **Archive data:** the family order and 15,000–20,000 ranges match the summary and the original report (seed 1101 Protected 1791–3599, Hunter 254–1065). The raw data confirms the seed 1103 losses.
- **Cadence wording:** the methods text first said censuses were taken every 25 ticks, which was wrong. It now correctly says every 100 ticks, with 25 ticks per movie frame.
- **Summary check:** `summarize-long-run.py` uses cwd-relative paths, so the isolated temp-directory rerun is real.
- **Packaging:** the Vite config uses `appType: "mpa"`, so the playground's all-14-routes-resolve check is not vacuous. The delivered videos total about 16.9 MiB, under the 32 MiB budget. The Caddy guards are case-insensitive and tested.
- **Decision log:** the `decisions.html` addition says validation is pending and claims no new 20,000-tick run, merge or deployment.
