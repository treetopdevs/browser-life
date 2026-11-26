The plan is honest in its disclaimers: no calibrated score, unequal horizons, caps, supplied food, no new simulations. It has gaps that would undermine "choosing varied life-like behavior" and the HTML deliverable, listed below by priority.

**1. The footage inventory is unchecked, and a missing recording could skew the shortlist.**
- This checkout has no `runs/`. All particle-world recordings are gitignored files in sibling worktrees, such as `spatial-particle-worlds/…/runs/spatial/browser/flocks-seed-1201.webm`.
- I found no recording at all for bonds or boundaries. `boundaries-validation.md:28` names `runs/boundaries/browser/boundaries-seed1201-through-3000.webm`, but it exists in no worktree I searched.
- Spatial videos other than flocks sit under `video-source/` with `page@<hash>` names. I didn't open them to see what they contain.
- Add a first step that lists every candidate world with a source path, existence and hash. It also needs an exclusion rule, so worlds without surviving footage are flagged "no footage" rather than quietly ranked lower or dropped.

**2. Several recordings are known to be unreviewed or stale, and the plan doesn't carry that forward.**
- `spatial-validation.md:13` says the complete videos weren't reviewed end to end.
- `oases-visual-check.md` says its recordings were "not continuously reviewed".
- `seasons-visual-check.md` says the 1202 recording predates the final phase-label polish, and no video was inspected there.
- Spatial recordings predate a heading edit, and the matter recording uses the initial renderer.
- Step 2 should require a per-clip record of what was actually watched (full clip or sampled ticks) and flag recordings made with an older UI.

**3. No rubric is fixed before the inspection.**
- The only criteria are sustained change, legible family behavior and a limitation a small slice could fix. "Varied" appears in your goal but is never defined.
- `backlog-status.md` already leans toward spatial ("materially different behavior opportunity"). Spatial and the ecosystem are also the newest work, so recency could drive the pick.
- Fix a short rubric and any vetoes in the doc before looking at footage, and use the same fields for every world.
- The rubric should include the negatives the records already contain:
  - `current-validation.md:7`: "not yet richly varied late behavior".
  - `seasons-visual-check.md`: "no broad spatial reorganization".
  - Spatial flocks 1202: late occupied bins fall to 6.0 with a z-band of 2–2.
  - Oases pilot: still, slow and faster arms look nearly identical in displacement and contact change.
- Step 2 preserves only the less diverse ecosystem outcome (seed 1103 ends Protected-heavy with three families). Every world should get the same treatment.

**4. Re-encoding the ecosystem movies adds loss and size for no clear gain.**
- The three delivered ecosystem mp4s in `apps/lab/src/ecosystem/archive-assets/` are already sampled, lossy, 192×192 and 17.7 MB together.
- Re-encoding them again compounds the loss and duplicates what `/ecosystem/archive/` already hosts.
- The plan sets no total byte budget. The previous slice used under 32 MiB.
- Reuse those mp4s by hash, re-encode only the webm sources, and set a budget.
- Record both the source hash and the delivered-copy hash for each clip, and say that the delivered copy is not the original.
- Use `preload="none"` or `metadata` so opening the page doesn't pull tens of MB. "Start paused" alone doesn't ensure that.

**5. "Portable HTML" and "links to local app paths" conflict.**
- App routes like `/ecosystem/` and `/particles/` are root-absolute and only work under `pnpm dev`. They break from `file://` or a docs viewer.
- Report links are relative markdown, which a browser shows as raw text.
- Label the app links "requires `pnpm dev`", keep the report links relative, and have the link check treat the two kinds separately.

**6. The next-slice plan needs commitments made before building.**
- State that the fixed cases and stop rules are written before implementation starts.
- Tie the chosen slice to a limitation already recorded in the portfolio. For example, `current-validation.md:7` already names "less uniform transport geometry" as the next experiment.
- Acknowledge that every candidate shares supplied-food steering. Part of its "life-like" quality is authored, so the pick shouldn't be framed as discovered behavior.

**7. Smaller points.**
- The video pages need text alternatives and no autoplay. Verify keyboard access, not just responsive layout.
- `decisions.html` is a single 30 KB line with existing `id=` anchors. Say which anchor the comparison entry goes in, so the update doesn't clobber others.
- Typos: "tip637b6f59" and "Sonnet5.5".

`reviews/comparison-plan-claude.md` is a 0-byte untracked file. I didn't touch it.
