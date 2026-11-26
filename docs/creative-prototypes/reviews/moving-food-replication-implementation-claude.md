**No blockers in the core runner. One blocker in the diagnostics helper, plus a few non-blocking gaps.** This was read-only, with no simulations and no vitest. I read `explore.ts`, the diagnostics helper and its test, the evidence test, and parts of the viewer and e2e spec, and ran hash and `diff` checks. I did not read the viewer UI beyond the receipt and manifest validation, and I did not inspect `explore.ts` outside the diff plus lines 36–80 and 503–512.

## Blocker

**`tools/moving-food-replication-diagnostics.mjs` can be satisfied by a receipt nobody else checks, and its ordering gate is untested.**
- **Filename mismatch.** The helper requires `docs/creative-prototypes/moving-food-replication-visual-<seed>.json` to be unchanged in HEAD.
  - The e2e spec (`tests/e2e/moving-food-replication.spec.ts:198,222`) uses `moving-food-replication-visual-receipt-<seed>.json`.
  - The viewer follows whatever `decision.visualReceiptUrl` says (`moving-food-replication-viewer.js:428-450`).
  - So the receipt the viewer shows can differ from the one the helper gates on.
- **Fix.** Pick one canonical name. Better, have the helper also require the pair manifest's `decision.visualReceiptSha256` to equal the digest of the receipt it read.
- **Test gap.** `tools/test/moving-food-replication-diagnostics.test.ts` only covers `overlap()` and rejection of seeds 1201 and 1204. Nothing tests the committed-receipt gate. That covers an untracked file, a modified or uncommitted file, a wrong arm hash, a wrong seed, or missing observations.
- **Why it's hard to test now.** `ROOT` and the docs directory are hard-coded. Make them injectable, or build a temp git repo in the test.

## Non-blocking gaps (fix before the final review)

- **Missing frames don't force a fail.** The helper emits `available:false` when a frame is absent, such as an extinct arm at 1500, 2500 or 3000. It never checks that the receipt marks that tick `pass:false`. The plan says unreached windows fail. Add the check in the helper, and in the viewer's "promising" conflict test around line 635.
- **No plan SHA in the receipt.** The receipt and helper don't bind `planSha256`. Arms and the future manifest carry it.
- **No manifest generator.** `tools/moving-food-replication/` holds only `explore.ts`. Only the e2e fixture and the browser viewer touch the per-seed pair manifest. Nothing in Node writes or checks it.
  - That includes the "arm hashes and decisions equal what the receipt and diagnostics bound" check.
  - Add a small `--manifest-check` step before the scheduled runs, or accept that the viewer is the only validator.
- **Failed attempts aren't logged.** The tooling doesn't enforce the plan's "log failed attempts" rule. `writeEvidence` computes both arms before writing and uses `wx`, so a failure leaves nothing partial. A repeat run is only blocked if files were already written. Log failures by hand.
- **Child-process errors are opaque.** `legacyCheck` uses `stdio:'pipe'`, so a legacy-check failure loses its stderr. Surface it.
- **Wrong-seed message is misleading.** The wrong-seed baseline throws "pinned uniform baseline prefix is incomplete". The behaviour is correct, but the message hides the real cause. The test at `evidence.test.ts:55` depends on that text.
- **Test coverage is thin on the new bindings.** The evidence test has no case for an arm that uses the other seed's baseline hashes, a tampered or missing `planSha256`, or the overwrite refusal. It also has no case for an unsupported seed in `runArm`.
- **Some 1201 files aren't pinned.** `moving-food-summary.json`, `-results.md`, `-validation.md` and the 1201 viewer and media are covered only by git. This is fine if the 1201 decision lives in the pinned `moving-food-index.json`. Otherwise pin `moving-food-summary.json`.
- **`explore.ts` is untracked.** Its hash goes into every artifact's `sourceSha256`, so commit it before any scheduled run. The diagnostics helper isn't pinned in the pin list.

## Checked and clear

- **Frozen history.**
  - The plan SHA matches both disk and HEAD `22e60fce`, with no working-tree change.
  - All 10 pinned model, tool and 1201 inputs I checked match disk, including every PR103 file and the old `tools/moving-food/explore.ts`.
  - The new `moving-food/model.ts` pin equals the old runner's, and `git status` shows `apps/` and the old tools unmodified.
  - That closes the "no silent rule edits" check against disk and against the old pins.
- **Seed identity.**
  - The `diff` shows the only changes are seed parameterization, `planSha256` provenance, and the added pins and legacy checks.
  - The gate, windows, RULES, caps, accounting and snapshot schedule are byte-identical to the old runner.
  - `parseArgs`, the evidence envelope, snapshot identity and prefix seed (`p.seed===a.run.seed`, `prior.run.seed===a.run.seed`) all accept only 1202 and 1203.
  - The 1201 string appears only in pinned inputs and the deliberate `legacyCheck('../moving-food/explore.ts',1201)`.
- **Own-baseline bindings.**
  - The 1202 and 1203 baseline JSON, Markdown and data triples match disk.
  - `baselineData(seed)` re-checks the artifact, Markdown, internal digest, seed, mode and 9000-tick run.
  - Both baselines have snapshots at 0, 6000, 7000, 8000 and 9000, with 451 samples, 451 frames, 9000 rows and `maxHistory` 451. So the "exactly one snapshot ≤3000, at tick 0" rule matches the plan's "available full snapshot 0" and claims no unavailable comparison.
- **Stop rules and safety.**
  - The import guard prevents execution on import.
  - `--write` runs the endurance check for the seed, then the 1201 check, then the baseline check.
  - It refuses to overwrite existing files and writes with `wx`. It enforces the 24 MiB cap and re-checks source identity after each arm.
  - `--check` and `--replay-check` are the only paths that re-run the simulation.
  - The viewer rejects `overall*` keys, enforces at least two visual passes plus the late-motion pass for a "promising" decision, and requires a SHA-bound receipt for any non-pending decision.
- **Receipt schema.** The helper and the viewer validate the same receipt fields. The helper is stricter on the git check. The viewer also accepts `reviewedAtUTC`, and the helper ignores extra keys.

Unit tests, e2e specs, the viewer UI beyond receipt/manifest validation, and the media tooling were not run or reviewed.
