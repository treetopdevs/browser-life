
## Plan review dispositions

Review: Codex Sol 6.1 xhigh, read-only. Prompt `plan-review-prompt.md`, raw output `plan-review-sol.txt` (also /tmp/assembly-destruction-2026-11-02-plan-review-sol.txt). Verdict: request changes before freeze. PLAN.md section 0 (R1-R14) carries the binding revisions.

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | P1 | highAssembly cannot reject crystal (a=4 for both) | Accepted. Gate redefined as a level gate (R3); crystal expected to pass it; separation only by identity+ablation; limit stated. |
| 2 | P1 | C1 tests stored-template rendering, not heredity | Accepted. Property renamed recipe-dependent reconstruction; added stored-image-renderer and wrong-store-builder controls; heredity declared untestable here (R2). |
| 3 | P1 | identityReturn conflates presence with abundance | Accepted. Copy-count recovery (n2-n1)/(n0-n1), n0>=8, persistence required (R4). |
| 4 | P2 | whole-object regrowth cannot restore mass; unspecified rules | Accepted. Sweep of fragments, 2 objects/round, residual recorded, crystal nucleation frozen, C3 expectation removed (R5). |
| 5 | P2 | random outcomes forced by tests; K=1 may not differ | Accepted. Separate init/regrow streams; outcomes measured; tests use constructed inputs (R6, 5b). |
| 6 | P1 | scramble gate contradicts target destruction; monomer handling | Accepted. Split class-loss measurement from organisation control; undefined and not-applicable rules (R7). |
| 7 | P2 | scramble gate has no numeric criterion, wrong direction | Accepted. 14/16 worse-side count, cost direction explicit, per-row measurement-limited (R7). |
| 8 | P2 | empty regrowth passes levelReturn | Accepted. Positive baseline and occupancy floor, else undefined (R4). |
| 9 | P2 | process verdict vs 96 replicate predictions | Accepted. Per-replicate binary predictions plus separate aggregation table, precedence, rejection rules (R8). |
| 10 | P2 | freeze/isolation not enforced | Accepted. dev/score seed namespaces, scorer-only reference key, write refuses on freeze mismatch, decision-path hashes pinned (R9). |
| 11 | P2 | applyLesion semantics misstated | Accepted. Synthetic occupancy deletion, not a mirror (R10). |
| 12 | P2 | clip timing and abstention flag ambiguous | Accepted for stage 2 only; own sampling loop, inherited abstention wording (R11). |
| 13 | P2 | artifact-dependent tests before artifacts exist | Accepted. Order fixed (R12, section 6). |
| 14 | P2 | moving origin/main baseline, untracked files | Accepted. BASE commit and porcelain guard (R13). |
| 15 | P2 | scope not credible for 2h | Accepted. Page, e2e and clip arm deferred to stage 2 (R1). |
| 16 | P3 | Docker privacy wording reversed | Accepted. Corrected (R14). |

No finding was rejected. Pre-damage keys as reference targets are legitimate if isolated from regrowth (reviewer concurred), and the first-rung thresholds are calibration, not independent validation; PLAN states this in R9/R3.

## Freeze review (Codex Sol xhigh, read-only, before the freeze commit)

Prompt `freeze-review-prompt.md`, raw output `freeze-review-sol.txt`. Six findings, all accepted and fixed before freezing:

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | P1 | `--replay-check` generated score rows before verifying freeze | Fixed: `replayCheck` runs `checkSaved` (artifacts + freeze) first and returns its problems without calling `buildPayload`. |
| 2 | P1 | outcome-bearing or merge commits could qualify as a freeze | Fixed: `checkFreeze` rejects merge commits and any evidence.json, manifest.json or EVIDENCE.md present in the tree at the freeze commit. |
| 3 | P2 | validation accepted zero denominators, empty c8 histories, unknown rows, inconsistent counts | Fixed: exact process and row-count check, positive rationals in [0,1], round histories for every variant, identity recomputed from n0/n1/n2, persistence from round counts, n2 equals last round. Tests added. |
| 4 | P2 | D4 uncertainty missing | Fixed: a `d4` variant (D4-equivalent objects count as copies, 4-connectivity) is carried in every row; `labelD4` and `segmentationDominated` cover c8 and d4. |
| 5 | P2 | 32-bit FNV memo key could alias patches | Fixed: memo key is the full frame bytes. |
| 6 | P3 | C3 always negative | Accepted: PROTOCOL says C3 is false for every process, an analytical base-rate control (80/96 base, 96/128 extended). |

## Dated note 2026-11-17: landing on main

The frozen protocol and code landed earlier (PR #166, freeze commit `01fb4660`); this change adds the records that were left out of it: PLAN.md, this file, `evidence.json`, `manifest.json`, the two review prompts and the two test files. The raw Sol outputs (`plan-review-sol.txt`, 504 KB; `freeze-review-sol.txt`, 429 KB) and the `.done` marker were scratch and are not carried; the dispositions above are the record. `evidence.json` and `manifest.json` are byte-identical to the stored originals and no outcome was changed. Every source hash in the manifest still equals the tree on main (none of the pinned assembly, metrics or destruction files changed in the 3D line), so no re-pin was needed; `node tools/assembly/destruction.ts --check` passes. `--replay-check` also passes (the payload regenerates byte for byte). One test was changed: the "protected paths untouched" test compared the working tree to the pre-freeze base commit, which no longer holds after the 3D line changed `packages/schema`, `sim-ref` and others. It now checks that the freeze commit itself did not touch the protected paths, that the first rung's `evidence.json` is unchanged, and that its manifest differs only in `sources` (the PR #173 re-pin).

Landing review (Sol 6.1 high, read-only): no P1. P2 (the rewritten protected-paths test checks base to freeze plus a clean tree, so it cannot catch a committed protected-path change in a later commit): declined; the base commit is a moving point once main changes those paths, and dynamics changes are caught by the golden pins. P3 (resealed-tamper test does not recompute the seal): declined, the test asserts rejection only. P3 (no-write test checked existence only): fixed, it now compares evidence.json and manifest.json bytes before and after.
