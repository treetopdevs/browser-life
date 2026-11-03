# I06b review log

## Plan review dispositions (Codex Sol 6.1 xhigh, 2026-11-02)

Prompt: `plan-review-prompt.md` (also /tmp/niche-construction-fe-2026-11-02-plan-review.md). Raw final message: `plan-review-raw.txt` (full transcript /tmp/niche-fe-plan-review-raw.txt). Verdict: revise before implementation. All 14 findings accepted; PLAN.md is now v2.

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | P1 | far-field-energy cannot make the gate `supported` (ablation only converts P to C, so D_poly = 0) | Accepted. Fixture now tests the inoculum contrast alone (`D_inoc` fooled, `D_inoc2` not); full gate rejected via D_poly = 0 and recorded; full-gate trap deferred (PLAN 2.1, 4.5, 11). |
| 2 | P1 | credit direction reversed; zero residual is an identity | Accepted. Credit dropped; signed `constructionGap = total(b) - total(f)` with stated sign meaning; all comparators enter the max (gap < 0 is the conservative side); physical conservation is each arm's own ledger (PLAN 4.1). |
| 3 | P1 | unchanged transfer audit cannot recognize a credit | Accepted by removal: no credit in the audit; per-arm own baseline, optional `baseline` param if needed, serialization-unchanged test (PLAN 3, 7). |
| 4 | P1 | G7 contradicts source-manifest checks | Accepted. Manifest-only re-pin of rung-1 `manifest.json` allowed (I08 precedent); other rung-1 files byte-identical; gate changed to `git diff --name-only` must list only manifest.json (PLAN 3, 6, 8). |
| 5 | P1 | positive control uses allowP placement real assay forbids | Accepted. Qualifying control must use ordinary placement; allowP walls diagnostic only; if no legal geometry, control unavailable and rung ends unsupported-measurement (PLAN 4.3). |
| 6 | P2 | fB loses free E through the d1B debit | Accepted. fB omits the lattice debit; free E equals b cell for cell before and after placement; extra bound energy shows as gap < 0 (PLAN 4.1, 7). |
| 7 | P2 | replicate seeds outside reservation | Accepted. Reserve contiguous 8,601,001-8,608,999 (R up to 8), collision scan over the enumerated list, protocol hash binds it (PLAN 5.1, 7). |
| 8 | P2 | free-gap-replay reversed direction | Accepted. Direction corrected to d0 MORE free E (22,169 vs 9,917) (PLAN 4.1, 4.5). |
| 9 | P2 | stopped outcome cannot produce promised artifacts | Accepted. `--write` always seals a payload (stopped if nothing qualifies); only fresh simulation is gated; artifact tests run after generation (PLAN 7, 8). |
| 10 | P2 | G3 / G-NOISE not one reproducible rule | Accepted. Per candidate, limiting gating contrast in summed-R units, wall pass rule 7 of 8 and median >= delta_c, ladder adds 60, doses strictly <= candidate ceiling (PLAN 4.2, 4.3). |
| 11 | P2 | noise gate does not establish power | Accepted. Power statement added (k >= 13; 40.5% at 0.75, 79% at 0.85, 93% at 0.90, 99% at 0.95); a negative is bounded to "no benefit >= delta in about 90% of blocks" (PLAN 4.2, 5.3). |
| 12 | P2 | freeze not enforced by existing lock | Accepted. Lock also binds niche source hashes; `--write` and `--replay-check` verify lock, clean tree and pushed identical lock via `git ls-tree origin/...` before any fresh seed; guard test (PLAN 9, 7). |
| 13 | P2 | survival rule cannot support survival claim | Accepted. Survival recast as field-arm viability (14 of 16); paired survival contrast attribution only; claim limited to biomass benefit (PLAN 1, 4.2, 5.3). |
| 14 | P2 | budget omits dominant work | Accepted. Full workload enumerated (wall ladder worst case about 184k steps), calibration reused at write, builder dose-response dropped, cut order stated (PLAN 8 G6, 11). |

Reviewer confirmations kept: shared Stage-1 histories are valid paired blocks (sum over R does not inflate n); absolute-T1 alignment supported by the code; founder scaling needs no WorldConfig key (knob dropped anyway). Seed ranges in the original plan had no collisions with the current registry.

## Freeze review dispositions (Codex Sol 6.1 xhigh, 2026-11-02, before the freeze commit)

Prompt: `freeze-review-prompt.md`. Raw output (full transcript incl. tool reads): `freeze-review-raw.txt`. Verdict: the stopped outcome is justified; freeze enforcement needed fixes. All 8 findings accepted and addressed before the freeze commit; no fresh seed had been read. A second review pass of the fixes was not run; the guard fixes are covered by stubbed-git tests instead.

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | P1 | guard read a local `origin/...` tracking ref, not the remote | Fixed. `freezeGuard` runs `git ls-remote origin refs/heads/<branch>`, takes the remote commit, requires it in the local object store, and compares that commit's blobs with `git hash-object`; stubbed tests for no remote branch, missing local commit, dirty file, missing or differing blob. |
| 2 | P1 | exported `generateFe()` bypassed the guard | Fixed. `generateFe(git)` calls `guarded()` first; `--write` and `--replay-check` reach simulation only through it; test: it rejects (stubbed git) before any simulation. |
| 3 | P2 | PLAN.md and Amendment 3 outside the lock | Fixed. `planSha256` in the lock, PLAN.md in `frozenPaths` (so also in the pushed-identical set), `verifyLock(planPath)` test that a document-only change fails. PLAN.md is therefore not edited after the freeze commit. |
| 4 | P2 | power wording overclaimed an exclusion bound; Holm threshold depends on candidate count | Fixed in `PROTOCOL_FE.powerStatement`, `LIMITS_FE`, the page disclosure and PLAN 4.2: a negative is a failure to detect under these rules; 13 of 16 with three candidates, 12 with one. |
| 5 | P2 | ladder stop rule ignored G-NOISE | Fixed. `settled()` (qualified, or passing dose known and all within-ceiling doses run); `runLadder(deltas, ceilings, ...)`; unit test with the reviewer's counterexample. Calibration re-run: byte-identical to the first run apart from the new field below. |
| 6 | P3 | fB `gap < 0` claim wrong (gap to b stayed positive in dev) | Fixed in code comment, PLAN 4.1 and the test (asserts `gap(fS) - gap(fB) = (eB - eA) * dB`). |
| 7 | P3 | `inoc2 <= inoc` by construction, so "did not rescue" was predetermined | Fixed. Added reported-only `inocMatched = Y(b) - max(fU, fS, fB)`; PLAN section 10 now says `inoc2` equalled `inoc` in 24 of 24 dev blocks and reports `inocMatched` (zero or negative in 21, positive in 3). The registered gate is unchanged. |
| 8 | P3 | wrong numeric summaries in Amendment 3 | Fixed: floor reductions 15.5%, 11.4%, 27.7%; best weakest-contrast median 1.5 (space contrast best 29.5); all recomputed from `calibration.json`. |

Reviewer confirmations kept: the lock matched all 38 sources, calibration, reservation digest and 176 enumerated seeds; saved sums, contrasts, deltas, ceilings and wall summaries agree; W2 reproduces zero placeable cells; the stopped report gives three `unsupported-measurement` labels and an empty negative list; free-E matching, signed-gap arithmetic, shared placement and audited conservation correct; physics packages, golden pins, `RULE_VERSION` and `defaultConfig` untouched; rung-1 `--check` passes.

## Source review dispositions (FIX stage, 2026-11-02)

Frozen sources (anything in the lock's source set, including `evidenceFe.ts`, `replicate.ts`, `tools/niche/fe.ts`) were not edited: the lock, calibration, evidence seal and manifest are unchanged. Fixes are in tests, the lab page (`apps/lab/src/niche/fe.ts`, `page.ts`, `index.html`) and EVIDENCE.md.

| # | Sev | Reviewer | Finding | Disposition | Evidence |
|---|-----|----------|---------|-------------|----------|
| 1 | P2 | sol | Sealed limits text and page say W1 "shows the assay can detect" a polymer structure though every qualification is false | Fixed on the page, not in the seal. `limitsFeHtml` restates the sentence conditionally ("A passing control would demonstrate...") and, when no candidate qualified, states that no control passed at any dose. Sealed `evidence.json` line 31641 and `LIMITS_FE` stay byte-identical (editing them would break the freeze lock and need a re-seal); EVIDENCE.md has a dated correction section. | `niche-fe-render.test.ts` "limits: the sealed ... restated conditionally" (failed and passed payloads) |
| 2 | P2 | sol | W2 positive-control test truncated to 4 seeds, only checked contrast names | Fixed. All 8 fixture seeds; asserts `fullGateLabel === "supported"`, `caughtBy` empty, each gating contrast at least 7 of 8. | `niche-fe-fixtures.test.ts` hand-wall-gate-W2 passes (187 s) |
| 3 | P2 | sol | verifyLock test only asserted an array | Fixed. New `tools/test/niche-fe-lock.test.ts` overlays `node:fs` (no frozen file touched): valid lock returns `[]`; missing lock, missing calibration, corrupt calibration, unparseable lock, altered protocol hash / seeds / registry digest, altered or dropped source binding are each refused; `generateFe` rejects each with the lock problem listed (the guard evaluates the lock and the git freeze check together, so git is consulted but a git answer cannot clear a lock failure) and before any simulation. The old test now requires `[]`. | 8 tests pass |
| 4 | P3 | sol | Noise assertion `f4 <= 4*f1` allowed no reduction | Fixed: `f1 > 0` and `f4 < 4*f1`. | readout test passes (f1 = 231, f4 = 500) |
| 5 | P3 | sol | Page omits G-NOISE from the qualification rule | Fixed in the dose-ladder caption (G-NOISE, ceiling = twice median dev builder polymer). Merged with claude P2 #8. | render test "page captions" |
| 6 | P3 | sol | Replicate-survival test did not exercise R-1-of-R | Partly fixed, remainder deferred. The conversion is inline in `runBlockFe` (frozen `replicate.ts`), so it cannot be driven with chosen survivor counts without editing a frozen source. New test checks, on real R = 4 blocks, that `viable` equals `survivedReps >= R-1` and `survivedReps` equals the positive-replicate count, plus the 2/3/4 table (false/true/true) on the rule itself. Extracting a pure function waits for a later freeze. | readout test "block viability is the R-1-of-R conversion" |
| 7 | P2 | claude | Render tests did not fail when the feature broke (six mutations all passed) | Fixed. Fixed-payload tests assert effect text and dose, detected/not-detected wording, bar widths, `k/8` strings (and `k/4` when the seed count changes), within/above-ceiling per row, and each comparator row's own gap text. Re-ran mutations: swapped GAP_WORD, inverted detected conditional, inverted ceiling comparison, hard-coded 16, hard-coded bar scale: each now fails (5 of 5 tried). | `niche-fe-render.test.ts` |
| 8 | P2 | claude | Caption states weaker rule than `qualify()` and misdescribes the fallback row | Fixed. Caption adds G-NOISE; the noise caption describes the best-dose fallback that the shipped stopped evidence uses. | index.html, render test |
| 9 | P3 | claude | EVIDENCE.md generalizes from one geometry; -190 vs -194.5 | Fixed. Reworded to "the only legal geometry (a W1 ring)"; limiting contrast at 1200 quoted as poly, -194.5 (builder -190). | EVIDENCE.md |
| 10 | P3 | claude | `inoc2` equals `inoc` in 24 of 24 real blocks, so matched comparators never enter the gating contrast | Fixed in text. EVIDENCE.md states plainly that gating `inoc2` is still dominated by d1E/d1B on real fields, that only reported `inocMatched` is free-energy-clean (negative 21, positive 3), and that only fixtures show the matched comparators changing a contrast. No gate outcome or rule changed. | EVIDENCE.md |
| 11 | P3 | claude | Inconsistent "before the receiver arrives" heading and far-field caption naming only the polymer contrast | Fixed. One phrase ("before the inoculum is placed") in heading and caption; far-field caption says the gate rejects on polymer, space and inoc2 (poly 0 of 8 one reason), matching `caughtBy`. | index.html, render test |

Open: only the deferred remainder of #6 (pure R-1-of-R function, needs a new freeze).

### Follow-up review of the fixes (Codex Sol 6.1 xhigh, `review-sol-fixes.txt`)

No P1. Frozen sources, lock, calibration, seal and manifest verify (`verifyLock` and `checkSavedFe` both `[]`); 49 selected tests passed including eight-seed W2.

| Sev | Finding | Disposition |
|-----|---------|-------------|
| P2 | `limitsFeHtml` treated unqualified as undetected (a passing dose above the ceiling would be called "no minimum detectable dose") | Fixed: the failure sentence requires `!qualified` and `minDetectableDose === null` for every candidate; test with detectable dose 240 and ceiling 200. |
| P3 | Viability boundary untested (both real blocks have 4 survivors; a 4-of-4 mutation passes) | Deferred with #6: production blocks cannot be driven to 2 or 3 survivors without editing the frozen `replicate.ts`; the test comment says so and the handwritten table is labelled as the rule only. |
| P3 | Log overstated "before consulting git" | Fixed: wording and test title corrected (rejection holds regardless of git's answer). |

Checks rerun: `pnpm typecheck`; vitest `niche-fe-lock`, `niche-fe-evidence` (incl. `checkSavedFe`, seal, manifest), `niche-fe-render`, `niche-fe-dose`, `niche-fe-comparators` (52 tests); `niche-fe-readout` noise-floor and viability tests; `niche-fe-fixtures` hand-wall-gate-W2 at 8 seeds.
