# Historical ecosystem observations

These files preserve the three earlier20,000-tick runs for seeds1101–1103. Open the local `/ecosystem/archive/` page for working videos and charts, or `/ecosystem/` to interact with the unchanged model. The local `/playground/` directory links the complete creative portfolio.

`source/` contains snapshots of the previous worktree's untracked raw histories, summary, report, companion HTML and concise analysis/review. The old companion retains its original relative links to that worktree's ignored `runs/` directory; it is an inert provenance artifact, not the new player. Use the new archive route for playback. These working files were not part of the immutable model commit.

The [manifest](provenance.json) records the original paths/hashes, immutable model base, copied records, and both original and delivered video metadata. The original H.264 videos already used lossy encoding. Browser copies are re-encoded at192×192 and retain all801 frames at20fps; neither form is a physical checkpoint. Matching hashes and metadata establish the retained files, not an independent pixel-to-census proof.

The raw history contains201 censuses every100 ticks. Movies sample every25 ticks. Trait bins permit recomputing within-family trait means and sampled novelty. Stored spatial-change measurements can be re-aggregated but not independently re-derived from these censuses. Charts describe the whole recorded run even while a movie is paused or seeking.

The combined explicit gate is `pnpm verify:ecosystem` under Node24. From the repository root, `python3 tools/ecosystem-library/verify.py` checks committed artifacts, metadata and summary regeneration. It requires ffprobe. Add `--originals` to additionally check the original movies at their recorded paths; this explicitly fails if they are unavailable. A fresh checkout needs only committed files for the default check. `node tools/ecosystem-library/replay-3000.ts` under Node24 verifies allthree earlier3,000-tick censuses using the transplanted model. It does not rerun20,000 ticks.

No deployment, new20,000-tick simulation or open-ended evolution is claimed.
