## Plan review: ecosystem library (Sonnet 5.5 High)

I read `CLAUDE.md`, the plan, and the original worktree's model, UI, tests, `long-run.ts`, doc and video metadata. I ran nothing apart from `ffprobe` on one video and a hash of `model.ts`. Nothing was edited. The review file is empty, so this reply is the review.

Some things check out. The `model.ts` SHA-256 matches the plan. The model imports nothing outside its own tests. There are 11 tests. The 125 bins and the 801-frame, 20 fps, 40.05 s figures hold. `floor(t*20)*25` capped at 20,000 is consistent. `long-run.ts` already compares the 3,000-tick census against the unsuffixed `docs/ecosystem-sandbox-exploration.json`, which is the v4 file. The plan's 14 cards match the routes.

### Blocking: decisions the plan leaves open

1. **Destination paths are never stated.** `long-run.ts` hard-codes `docs/ecosystem-sandbox-exploration.json`, `apps/lab/src/ecosystem/model.ts` and `runs/ecosystem-20k`. The copied docs refer to those names too.
   - Decide to keep every copied file at its original relative path. Only then does the provenance manifest and the `sourceHash` check (hash of that exact path) stay meaningful.
   - Also decide where `docs/ecosystem-20k.*` and `docs/ecosystem-sandbox-reviews/` land. The target has `docs/creative-prototypes/`.

2. **Where the raw histories, summary and browser videos live in the repo is unspecified.** `runs/` is gitignored, and the originals sit in the source worktree's `runs/`.
   - State the committed paths for the three seed JSONs (~1.2 MB total), the summary JSON and the three 192 px MP4s. State that the MP4s are committed and the 576 px originals are not.
   - Name the "outside Git" location for the originals. `runs/ecosystem-library` already exists in this worktree and could serve.
   - Say what CI and fresh checkouts do about original-file hash checks when the originals are absent. Options are skip with a visible notice, or manifest-only verification.

3. **Packaging gap if media goes in `public/`.**
   - The plan's Docker list covers `dist/ecosystem`, `dist/playground` and prefixed files. A `dist/ecosystem-archive/` directory, or any non-hashed copy, matches none of those.
   - Caddy guards like `^/ecosystem(?:/|$)` also miss `/ecosystem-archive-*` and `/assets/ecosystem-*`.
   - Pick one mechanism. Either import media so Vite emits `assets/ecosystem-archive-<name>-<hash>.mp4`, which requires source filenames that start with `ecosystem-archive-`, or add explicit `rm`/Caddy entries for the directory.
   - Also decide whether the JSON histories are fetched or imported. Imported ones get chunk names, and the `manualChunks` ids need the same prefix audit.
   - The smoke test should assert on the final built file list.

4. **The copied `docs/ecosystem-20k.html` references `../runs/ecosystem-20k/seed-*.mp4`.** Those links are dead once copied, and the plan only says "state their original context". The new archive page's data source is also not named. The companion inlines ~110 KB of data.
   - Decide whether the archive renders from the raw seed JSONs and summary, or from the companion's inlined data.
   - Prefer the raw JSONs, so the checker validates the same bytes the page displays.
   - Decide whether the old HTML stays as an inert historical copy with a banner, or is left out of the built page.

5. **"Recompute the descriptive summary from raw records" is under-specified.**
   - The summary includes the "~53/56/30% of sites change per 25 ticks" figures. These come from `spatialChangePer25`, which is stored per sample but was computed from video frames that are not retained. They can be re-aggregated but not re-derived.
   - The "new combinations in the last 5,000 ticks" figure comes from stored `newlySeen`.
   - Decide whether the checker re-runs the unchanged `summarize-long-run.py`, which hard-codes paths and needs python3, or reimplements the aggregation in TS. If it reimplements, say which fields are re-aggregated versus only checked for internal consistency.
   - Late births, deaths and mutations are cumulative counts. Define the window as cumulative(20000) minus cumulative(15000).

6. **Provenance claims are weaker than the plan implies.**
   - The untracked files (doc, summary, HTML, tools, raw JSON, MP4s) have no immutable commit. The hash is of the working-tree file, so say so rather than "immutable base".
   - `sourceHash` and `replay3000` in the JSONs are self-reported by the run that wrote them. The bounded replay only proves that the current model reproduces tick 3,000. Nothing ties the MP4s to the JSONs except the shared `long-run.ts` and matching timestamps. Word it as "recorded by `long-run.ts`", not "verified".
   - Make the manifest record the originals' own encoding. They are already libx264 crf 19 yuv420 at 576×576, a 6× nearest-neighbour upscale of the 96×96 state. So the "lossless physical snapshots" caveat applies to the originals as well, and `scale=192:192` samples 2 px per cell from the 6 px cell.
   - Record `ffprobe` of the originals too, not only hashes.

### Contradictions and smaller gaps

7. **"Preserve old explorer behavior" versus start paused.** The original `main.ts` starts running unless reduced-motion is set, and `visibilitychange` only resets `debt` and keeps running. The new rules are a deliberate behavior change.
   - The original `tests/e2e/ecosystem.spec.ts` emulates reduced motion and clicks Resume. It still passes on the start-paused path, but its hidden-page and mobile checks are new.
   - Say that `main.ts`, `index.html`, `style.css` and the e2e spec are expected to differ from the source, with both hashes recorded. Only `model.ts` must be byte-identical.
   - Say whether the e2e spec is copied then edited, or rewritten. Name the Playwright specs for the archive and playground, since the plan lists behaviors but no files.

8. **Video-derived tick label.** The 40.05 s duration puts `currentTime` at the end at `floor(801)*25 = 20,025`, hence the cap. libx264 with `+faststart` can also shift container duration or start offset.
   - Make the `ffprobe` check assert frame count 801 and `duration` of 40.05 within a stated tolerance.
   - Decide the tick source: `requestVideoFrameCallback` mediaTime when available, else `currentTime`.

9. **"No dead file links in the built playground."** `docs/creative-prototypes/decisions.html` is outside the Vite root (`apps/lab`), so a Vite-relative URL cannot reach it. Choose "omit the link from the built page" and keep it as source-reference text in the docs only.

10. **Test environment.** `ffprobe` tests need ffmpeg tools on the machine. Say whether a missing `ffprobe` fails loudly or skips with a notice, and whether those tests live in vitest or a Deno or Node tool under `tools/ecosystem-library/`. Note that `pnpm test` includes `tools/test`, and copied `tools/ecosystem/*.ts` stays out of the `tsc` include list (`tools/` isn't in it).

11. **Possible missing provenance files.** `runs/ecosystem-20k/review.md`, `analysis.txt` and `review.log` are the "bounded static audit" the doc leans on. The plan doesn't say whether they are copied or deliberately dropped. Copy `review.md` and `analysis.txt` if the doc's claim "late-window calculations match" is to stay traceable, and drop the rest explicitly.
