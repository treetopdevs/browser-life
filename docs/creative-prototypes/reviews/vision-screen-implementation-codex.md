Found three actionable defects:

- **[P2] Offline check accepts missing provenance.** [check.ts:12](/Users/nicholas/.codex/worktrees/vision-world-screen/browser-life/tools/vision-screen/check.ts:12) validates only the hash entries supplied by the artifact. An in-memory copy with empty `sourceSha256` and `provenance`, and missing runtime/score-file hash, still passes. Require the expected source paths and provenance fields before checking their values.

- **[P2] Calibration reruns overwrite retained evidence before failing.** [calibrate.ts:18](/Users/nicholas/.codex/worktrees/vision-world-screen/browser-life/tools/vision-screen/calibrate.ts:18) rewrites PPMs and the manifest, then invokes a scorer that refuses the existing `scores.json`. It subsequently overwrites the original scorer log with that refusal. Preflight before writing, or use a separate run directory, so reruns preserve the original evidence.

- **[P2] Comparison table labels the wrong metric.** [index.html:46](/Users/nicholas/.codex/worktrees/vision-world-screen/browser-life/apps/lab/vision-screen/index.html:46) says “Target minus strongest alternative,” but [page.ts:132](/Users/nicholas/.codex/worktrees/vision-world-screen/browser-life/apps/lab/src/vision-screen/page.ts:132) displays **target-fixture margin minus negative-fixture margin**. For `cal-120-layout0-6`, the image margin is −0.021881, while comparison values include +0.001729. Label the column “Target fixture margin − control margin” and explain its sign.

The current record passes the static check at **67/108**; retained manifest and score-file hashes match. I found no defect in the shared raster, fixed gate arithmetic, or stopped-selection decision. The existing build places the gallery artifact in the chunk covered by Docker removal.

No source edits, downloads, inference, or test-suite runs performed. Final validation remains with the parent.