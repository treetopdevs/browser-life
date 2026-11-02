# I06b Free-energy-matched comparators: niche construction, second rung (slice plan v2, after Codex plan review)

Status: PLAN stage, 2026-11-02. Branch `claude/i06-free-energy-matched` from `origin/main` 0bdd7a70. Sources: "I06" in `docs/simulation-research-2026-11-01/report.md`; the first rung `docs/niche-construction-2026-11-01/` (PLAN, EVIDENCE, REVIEW, sealed `evidence.json`); coordinator decisions D1, D3 in `/Users/nicholas/develop/browser-life-run-1102-log/docs/backlog-run-2026-11-02.html`. Exploratory, CPU only (`sim-ref`; GPU is allowed by the scope but not needed), mutation off, no physics change, no model calls, no deploy. v2 revisions answer `REVIEW.md` "Plan review dispositions" (P1-1..5, P2-6..14). This is a rung on the same tool, not a fork: every new behaviour is keyed off a second protocol object so the first rung's sealed evidence still verifies byte for byte.

## 1. Bounded question

Rung 1 ended `unsupported-measurement` for all three builder candidates (clusters 0, 4, 9). Three defects, each named in `EVIDENCE.md`:

1. **Comparator confound.** Receiver-alone controls (d0, d1E, d1B) match *total* energy but not *free* energy E (cluster 0, seed 8600501: 9,917 vs 22,169, both totals 26,969). The negative inoculum contrasts (23 of 24 blocks) therefore cannot be blamed on inoculum alone.
2. **Noise floor above the effect.** Dev replicate floors delta = 341 / 291 / 404 against builder polymer of 103.5 / 98 / 84.5 and a receiver reserve of B_r = 480.
3. **No positive control at realistic scale.** The hand wall was detected only at 1200 polymer (about 10x what builders leave); at 120 it was not (W1 4/8, W2 3/8 on dev).

Question for this rung: when the receiver-alone benchmark is matched on free energy as well as on total energy and matter, and the readout is powered to a noise floor below the effect it must detect, (a) does the assay pass a positive control at a stated, realistic polymer dose, and, only if so, (b) does a builder's conditioned field causally raise a receiver's receiver-labelled biomass inventory (survival is a viability requirement on the field arm, not a claimed benefit; a paired survival contrast is reported as attribution only) relative to nonbuilder, ablation, scramble and the free-energy-matched receiver-alone controls?

Valid outcomes, all reported as such: `supported` for a pair; `unsupported-within-tested-domain` (a usable negative, only when the positive control passed); `unsupported-measurement` with a stated minimum detectable polymer dose (the "stated reason none exists" branch of the scope); `invalid-or-incomplete`. A negative here does not say a second link is impossible, does not test mutation reaching builder or receiver, and does not test A+B->C.

## 2. What is built (one PR)

1. **Evidence fixtures with a negative case that fools the old inoculum contrast** (section 4.5). New fixture `far-field-energy`: a conditioned field that differs from its controls only by extra free energy laid in a band outside the inoculum footprint plus halo (no polymer). Because ablation only converts P to C (`transfer.ts`), with no polymer `b` and `ab` stay identical and `D_poly = 0`, so the complete rung-1 gate and the new gate both reject it. What the fixture tests is the **inoculum contrast alone**: rung-1 `D_inoc` (vs d0/d1E/d1B/region-matched) reads positive (fooled) while `D_inoc2` (with fU/fS/fB) does not. Evidence records `fullGateLabel` (unsupported, by `D_poly`) and `inocFooledOld` / `inocCaughtNew` separately; the claim made is about the contrast, never "the old rule would label it supported". A full-gate trap needs a polymer-bearing confound and is deferred (section 11). If the fixture cannot fool `D_inoc` at unit scale, the test fails and the slice reports that instead of weakening the claim.
2. **Small CPU path, same library.** Extensions in `packages/runner/src/niche/`: second protocol (`PROTOCOL_FE`), free-energy-matched comparators fU, fS, fB, R-replicate Stage-2 readout, dose-ladder positive control, decision with `inoc2`. `tools/niche/niche.ts` gains `--rung fe` (selects the second protocol and docs directory) in front of every existing mode; no new CLI.
3. **Manifest and machine-readable evidence:** `docs/niche-construction-fe-2026-11-02/{evidence.json,manifest.json,calibration.json,protocol.lock.json}`, sealed like rung 1 with `--write`, `--check`, `--replay-check`.
4. **Local page.** `apps/lab/niche/index.html` gains a "Second rung: free-energy-matched" section (same private route, still 404 on the deployed site) reading the second `evidence.json`: free-energy table per comparator (the 9,917 vs 22,169 style numbers, before and after matching), noise floor vs effect bar, dose-ladder positive-control chart, edge per candidate, the `far-field-energy` panel. Reads evidence only, runs no simulation.
5. Docs: this PLAN (carries the dated amendment, section 10), `REVIEW.md` (Codex dispositions), `EVIDENCE.md` (human result, written after the run).

## 3. Reuse and honest limits of reuse

- Reuse as is: `transfer.ts` (ledger, relabel, placement, scramble), `arms.ts` builders, `assay.ts` stage runner and readouts, `decision.ts` sign test / intersection-union / Holm, `evidence.ts` sealing, the rung-1 page helpers (`render.ts`), `EVIDENCE_STATUSES`. Rung-1 `PROTOCOL` object and every rung-1 code path stay byte-identical in behaviour; `--check` and `--replay-check` for rung 1 are acceptance gates (G7).
- **Registry binding.** Rung 1 hashes the whole registry (minus owners listed in `LATER_SLICE_OWNERS`). This rung adds the owner prefix `i06b free-energy-matched` to that list (the I08 precedent) and binds its own digest over its own reservation only, so neither rung's evidence is invalidated by the other's reservation.
- **Audit.** `transfer.ts` `Audit`/`residuals` have no credit term and `runArm` audits every census. This rung adds **no credit to the audit**: each arm's ledger baseline is that arm's own constructed starting total (lattice + reserve, heatAnalytic 0), so each arm's physical residual is exactly `0n` as in rung 1. The construction difference between `b` and a comparator is a comparison-budget `constructionGap` recorded in evidence only, not a ledger entry (it is not energy created inside any run). If the existing audit cannot take a per-arm baseline, add an optional `baseline` parameter defaulting to current behaviour and prove rung-1 serialization unchanged by test.
- **Manifest conflict (G7).** `tools/niche/niche.ts` `sourceFiles` hashes every niche `.ts` and `checkSaved` rejects changed or added files, so editing existing niche sources or adding modules fails rung-1 `--check` unless the rung-1 `manifest.json` is re-pinned. As in the I08 precedent (rung-1 REVIEW dated note 2026-11-02), a **manifest-only re-pin** of `docs/niche-construction-2026-11-01/manifest.json` is allowed; `evidence.json`, `calibration.json`, `protocol.lock.json`, PLAN, EVIDENCE and REVIEW of rung 1 stay byte-identical to `origin/main`, and rung-1 `--check` and `--replay-check` must pass after the re-pin. New rung-fe code goes in new files wherever possible to keep the diff to existing sources small.
- No change to `packages/schema`, `packages/sim-ref`, `packages/sim-gpu`, `defaultConfig()`, `RULE_VERSION`, golden pins, vendor, preregistration.
- All new arithmetic is analytical, integer (BigInt where it touches totals), outside the step function.

## 4. Design

Everything in rung-1 PLAN section 4 holds unless stated: single 24x24 tile, kernelRadius 5, mutation off, ladder genes, recurring injury with shell, T1 = 60, T2 = 80, reserve R = (480, 960), footprint (14,12) r3, halo 2, absolute clock T1 for every Stage-2 arm, candidates by panel `{0, 4, 9}` and receiver cluster 12, drop order 9 then 4 by runtime only.

### 4.1 Free-energy-matched comparators (answers defect 1)

Free energy means lattice channel E (`sum E`), reported next to total energy (`totalsOf`), for the builder-removed arm `b` and each comparator, at the start of Stage 2 (before inoculum placement) and after placement. Matter is identical in every arm (lattice plus reserve), as in rung 1. Observed rung-1 direction (seed 8600501, cluster 0): the receiver-alone control d0 held MORE free E than `b` (22,169 vs 9,917) with equal total (26,969), because `b` holds its energy as bound matter.

Matching free energy and total energy simultaneously is impossible at equal matter when the comparator has no conditioned composition (bound matter carries energy at eB, eP, eC, eA). Each comparator is a separately constructed initial state (not a transformation of `b` inside a run); its own ledger starts from its own total and conserves exactly. The difference is reported as `constructionGap = totalEnergy(b) - totalEnergy(f)` (signed BigInt, evidence only, never in the ledger): **gap > 0** means the comparator holds less total energy than the field arm; **gap < 0** means it holds more (a stronger comparator, the conservative side for the claim).

- **fU (uniform free-matched):** receiver-alone lattice, uniform A, free E set uniform to `sum E(b)` over the lattice.
- **fS (spatial free-matched):** as fU but E copied cell for cell from `b` (same free-energy field, no polymer, no biomass, matter all A in the remainder). Isolates "the energy pattern alone" from "structure".
- **fB (free-matched plus biomass-matched):** fS plus the rung-1 d1B raise of B (region plus halo, matter converted from A), **without** the `(eB - eA)*dB` lattice debit, so free E stays equal to `b` cell for cell before and after placement; fB holds `(eB - eA) * dB` more total energy than fS (the bound-energy increase is extra total energy, never a ledger entry). Its own `constructionGap` to `b` is recorded with its sign (positive when the field binds more energy in polymer or waste than fB is handed, negative or zero otherwise; `comparator-excess` where it is negative). Test: free-E equality before and after placement, and the fS-to-fB gap difference.
- Rung-1 d0, d1E, d1B are kept unchanged and reported (total-matched family).

New inoculum contrast: `D_inoc2 = Y(b | builder) - max(Y(d1E), Y(d1B), Y(fU), Y(fS), Y(fB))`; every constructed comparator is in the max (none excluded by sign of gap; `comparator-excess` and `comparator-deficit` are labels in evidence). Rung-1 `D_inoc` is still computed and reported next to it. The four gating contrasts are builder, poly, space, inoc2. A comparator whose construction would need negative lattice E or exceed `POOL_MAX`/`MATTER_MAX` is refused (`credit-overdraw`, never clamped); a block where fU, fS and fB are all refused is `invalid-or-incomplete` for that candidate (reported, never dropped).

### 4.2 Better-powered readout (answers defect 2)

- **Replicated Stage 2.** Each arm's Stage 2 is run for `R = 4` sim seeds (block seed plus fixed offsets `{0, 1, 2, 3} * 1000`), identical offsets in every arm (so injury steps and RNG keys still coincide across arms); Stage 1 histories and transfers are shared. Primary endpoint `Y = sum over the R replicates of receiver-labelled B at T2` (integer; no division, units are x R of rung 1). Viability: receiver B above zero in at least `R - 1` of R replicates counts the field arm `b` as viable for that block. Viability is a requirement for the gate (field arm viable in at least 14 of 16 blocks; at a true per-block rate of 0.9, 15/16 would pass only 51% of the time). A paired survival contrast (arm vs comparator) is reported as attribution, never gating, and no survival benefit is claimed.
- **Replicate seeds** are enumerated and reserved explicitly (5.1) for the maximum R of 8.
- **More blocks:** 16 fresh blocks per candidate (was 8). Exact sign test over 16; `k = 16` gives 1/65,536, `k = 14` gives 137/65,536, `k = 12` gives 2,517/65,536 (hand-enumerated in tests). Candidate threshold by Holm at alpha 0.05 over 3 candidates as before (1/60, 1/40, 1/20 for the three ordered p-values).
- **Power statement (frozen wording, corrected at freeze after the Codex freeze review; see section 10).** With three candidates running the first Holm rejection needs k >= 13 of 16 (p = 697/65,536; 12 if only one candidate runs). A contrast whose true per-block positive probability is 0.75 passes that single threshold 40.5% of the time, 0.85 gives 79%, 0.90 gives 93%, 0.95 gives 99%; four contrasts, delta and viability can only lower the pass rate. A negative is a failure to detect a consistent benefit under these rules, not an exclusion bound on the effect size and not evidence of no benefit. Dev reports the empirical positive-block rate of the wall control at the qualifying dose next to this table.
- **Delta from a replicate control with the same readout:** `delta = max(ceil(0.02 * B_r * R), 1.5 * max|D|)` over dev replicate pairs (nonbuilder vs nonbuilder, builder vs builder, on a disjoint replicate seed set of R sims). With the sum over R the expected floor falls by about sqrt(R) relative to rung 1 after rescaling; dev says whether it did.
- Secondary readout (reported, never gating): per-replicate area under the receiver-B census curve (sum over the 8 censuses), as a lower-variance cross-check.
- **Noise gate (G-NOISE, dev only, before any fresh seed), per candidate:** `delta_c` must be at most half of the wall control's median effect on the **limiting gating contrast** (the one with the smallest median effect among the four), in summed-R units, at that candidate's qualifying dose (4.3). Otherwise the rung stops `unsupported-measurement` and reports the achieved floor and the minimum detectable dose; the fresh seeds are not read.

### 4.3 Positive control at realistic scale (answers defect 3)

The hand-wall fixtures (W1 ring, W2 floor under the receiver; rung-1 definitions) run the full four-contrast gate on dev wall seeds across a dose ladder of total polymer `P in {60, 120, 240, 600, 1200}`, ascending, stopping each wall at its first passing dose (that dose is its minimum detectable dose); doses above the ceiling are run only if nothing at or below it passes, to state the minimum detectable dose.

- **Per-candidate realistic ceiling** `C_c = 2 x` the median dev builder polymer at T1 of candidate c (rung 1 measured 84.5-103.5, so C is about 170-207, which admits 60 and 120, not 240). The control for candidate c uses doses `<= C_c` only.
- **Ordinary placement required.** The rung-1 `wallGateBlock` uses `allowP: true` (overwriting polymer on injured cells), which real transfers (`placeAll` default false) forbid. The qualifying control must place the wall by the ordinary placement rule (no overwrite of existing polymer, same pool-cap and reserve guards) at cells where that is legal; wall variants that need `allowP: true` stay as a reported diagnostic and never qualify the assay. If no ordinary-placement wall geometry exists, the control is `unavailable` and the stated reason is that none exists, ending the rung `unsupported-measurement`.
- **Wall pass rule (dev, 8 wall seeds):** for each of the four gating contrasts, at least 7 of 8 seeds positive (exact p = 9/256) and median >= `delta_c`. A wall passes at dose P iff all four hold. The control **qualifies candidate c** iff W1 or W2 passes at some dose `<= C_c` and G-NOISE holds (4.2).
- A candidate that does not qualify ends `unsupported-measurement` with the minimum detectable dose, its ratio to the builder polymer and the floor that explains it; its fresh blocks are not simulated (a sealed stopped payload is still written, section 8). Candidates qualify independently.

Dropped from this rung (cut for scope, section 11): the builder founder-biomass dose-response knob.

### 4.4 Readouts, ledger and flux (unchanged from rung 1, per replicate)

Per arm and replicate: receiver survival, receiver-labelled biomass inventory, flux attribution (synthesis share; "growth" only at share at least half and no saturated counter), builder cost, before/after inventories. Ledger invariant per arm: lattice + reserve + cumulative heatAnalytic against that arm's own starting total, exact `0n` at every census of both stages, including every replicate (the unchanged rung-1 audit; no credit term). Evidence adds per arm: free E, total energy, `constructionGap` vs `b`.

### 4.5 Fixtures

16x16, kernelRadius 5 at unit scale (rung-1 constraint); the positive control is additionally qualified at the frozen scale on dev.
- `far-field-energy` (new, 2.1: fools rung-1 `D_inoc`, not `D_inoc2`; full gate rejects via `D_poly = 0`); also a uniform and an in-footprint variant, `caughtBy` recorded.
- `free-gap-replay`: rung-1 observed direction at fixture scale (d0 holds MORE free E than `b` with equal totals; bound inventories as recorded); asserts fU/fS/fB reproduce `b`'s free E exactly (difference zero), that d0's excess is removed, and that `constructionGap` is recorded with every arm's own ledger residual `0n`.
- `takeover-only`, `null-field`, `hand-wall-gate-W2` (rung-1 fixtures re-run with the second protocol; expectations unchanged).
- Guards re-run: overwrite, pool cap, underfunded reserve, exhausted reserve, plus `credit-overdraw` (a free-matched comparator that would need negative lattice E or exceed a cap is refused, not clamped).

## 5. Pre-stated rules (frozen before any fresh-seed run; dated amendment in section 10)

### 5.1 Seeds
Block seeds in `8,601,001-8,601,999` and every derived replicate seed are reserved in `experiments/discovery/seed-registry.json` (owner `i06b free-energy-matched`) **before** anything runs. Replicate sims use block seed + `k * 1000`, `k = 0..7` (R = 4 uses k = 0..3; R = 8 uses k = 0..7), so derived seeds reach 8,608,999: the reservation lists the contiguous range `8,601,001-8,608,999`; the implementer first runs `seedCollisions` over it and, if any existing owner collides, replaces the offset by a collision-free stride and records that in the amendment. The protocol hash binds the explicit enumerated list of every seed that can run (block, replicate, noise, wall, fixture) and the registry digest; `--check` rescans the enumerated list, not only base lists. Never reused: 8,600,101-108, 8,600,501-508, nor any other rung-1 seed. Dev blocks 8,601,001-8,601,008, dev replicate-noise 8,601,201-8,601,204, wall 8,601,301-8,601,308, fixtures 8,601,401-8,601,408, fresh 8,601,501-8,601,516. Dev outcomes may set only `T1, T2` (unchanged unless dev shows cause), `delta_c`, the dose rungs and ceilings, and `R` (4 or 8; one escalation to 8 allowed if the noise gate fails, recorded before the freeze). Fresh seeds are read once, after the freeze commit is pushed and verified (section 9).

### 5.2 Estimands
Primary `Y` as in 4.2, paired within a block. Gating contrasts: `D_builder`, `D_poly`, `D_space`, `D_inoc2`. Attribution only: `D_spaceP`, `D_spaceNP`, rung-1 `D_inoc`, `D_naive = Y(b) - Y(d0)`.

### 5.3 Edge label
Rung-1 rules with these changes only: 16 blocks; `inoc2` replaces `inoc`; per-contrast exact one-sided sign test (zeros non-positive) with `median >= delta`; field arm viable in at least 14 of 16 blocks (viability requirement, no survival-benefit claim); candidate p = max over four; Holm across candidates that ran. Adequacy is per candidate: the ordinary-placement positive control qualified that candidate at a dose within its ceiling and G-NOISE held (4.3); the rung-1 polymer criterion is a reported field only. `unsupported-within-tested-domain` only when valid, adequately measured and a gating test fails; its meaning is bounded by the power statement in 4.2. Mechanism text and the three-valued panel verdict as rung 1.

## 6. Files to add / change

Add:
- `docs/niche-construction-fe-2026-11-02/{PLAN.md,REVIEW.md,EVIDENCE.md,evidence.json,manifest.json,calibration.json,protocol.lock.json}`
- `packages/runner/src/niche/freeEnergy.ts` (fU/fS/fB construction, constructionGap, free-energy report), `packages/runner/src/niche/replicate.ts` (R-replicate Stage 2 and endpoint), `packages/runner/src/niche/dose.ts` (dose ladder, per-candidate ceiling, ordinary-placement wall qualification)
- `packages/runner/test/niche-fe-comparators.test.ts`, `niche-fe-readout.test.ts`, `niche-fe-dose.test.ts`, `niche-fe-fixtures.test.ts`; `tools/test/niche-fe-evidence.test.ts`; `apps/lab/test/niche-fe-render.test.ts`
- `apps/lab/src/niche/fe.ts` (page section: tables and bars only, no new chart dependency), `tests/e2e/niche-fe.spec.ts` (screenshots at 1280 and 375)

Change (small, additive):
- `packages/runner/src/niche/protocol.ts` (`PROTOCOL_FE`, `protocolHashFe`; `PROTOCOL` untouched), `arms.ts`/`assay.ts`/`decision.ts`/`fixtures.ts`/`evidence.ts` (extension points keyed on the protocol; rung-1 paths unchanged), `index.ts` exports
- `tools/niche/niche.ts` (`--rung fe`, `LATER_SLICE_OWNERS` entry, own-digest, lock/push guard of section 9, calibration reuse)
- `docs/niche-construction-2026-11-01/manifest.json` (manifest-only re-pin, section 3; nothing else under that directory)
- `experiments/discovery/seed-registry.json` (reservation), `apps/lab/niche/index.html`, `apps/lab/src/niche/page.ts` and `style.css` (section)
- Existing `Dockerfile.site` and `deploy/Caddyfile` already cover `/niche`; the packaging test is extended to prove the new section adds no new route or asset outside them.

No change to: `packages/schema`, `sim-ref`, `sim-gpu`, `defaultConfig()`, `RULE_VERSION`, golden hashes, vendor, preregistration, GENERATED sections.

## 7. Tests (named cases)

`niche-fe-comparators.test.ts`: `fU free E equals b free E exactly and matter equals`; `fS E channel equals b E channel cell for cell`; `fB free E equals b cell for cell before and after placement (no lattice debit, gap < 0 flagged comparator-excess)`; `constructionGap sign: positive when comparator total is lower`; `every arm residual 0n against its own baseline`; `rung-1 audit serialization unchanged`; `credit-overdraw refused not clamped`; `d0 d1E d1B unchanged from rung 1 (state hashes equal)`; `placement set still the intersection across arms`; `every arm starts at absolute step T1 with equal injury steps and RNG keys`.
`niche-fe-readout.test.ts`: `replicate offsets identical in every arm`; `Y is the integer sum of R replicate endpoints`; `R=4 sum noise floor on a no-op control is below R=1 floor scaled by R (dev-scale fixture)`; `instrumented twin equals plain twin (stateHash) per replicate`; `deterministic replay: same block twice equal bytes`; `segmented stage 2 equals continuous`; `survival rule R-1 of R`; `AUC reported not gating`.
`niche-fe-dose.test.ts`: `ceiling derives from dev builder P per candidate`; `no dose above the ceiling can qualify`; `allowP wall never qualifies, ordinary-placement wall required`; `wall pass rule 7 of 8 and median >= delta`; `failure yields minimum detectable dose and a sealed stopped payload`; `dose ladder deterministic across reruns`.
`niche-fe-fixtures.test.ts`: `far-field-energy: naive positive, rung-1 D_inoc positive (fooled), D_inoc2 not positive, full gate unsupported via D_poly = 0 (caughtBy recorded)`; `free-gap-replay closes the free-E gap`; `takeover-only still zero synthesis`; `null-field exact zeros`; `hand-wall-gate-W2 supported`; every guard refuses.
`niche-decision` additions in `niche-fe-readout`: exact sign p for n=16, k=12,14,16 against hand enumeration; Holm resolution at n=16; `no floats in sealed payload`; `panel verdict not negative when positive control failed`; `paired survival contrast reported, not gating`; `power table values (0.75: 40.5%, 0.9: 93.2%)`.
`niche-fe-evidence.test.ts` (artifact tests run only after generation): `evidence.json sealed and verifies`; `manifest hashes match sources`; `--write and --replay-check refuse without a verifying lock and a pushed identical lock (guard test with a stubbed git)`; `fresh seeds and every derived replicate seed disjoint from 8600101-108, 8600501-508 and the live registry`; `stopped payload seals and verifies`; `rung-1 evidence still verifies after the manifest re-pin; rung-1 evidence/calibration/lock bytes equal origin/main`; `--check does not simulate`.
`niche-fe-render.test.ts`: free-energy table rows incl. constructionGap; noise-vs-effect bar; stopped payload (positive control failed) shows "no fresh run" not "negative"; edge supported/unsupported/unavailable; caption "exploratory, CPU only"; `noindex` unchanged.

## 8. Acceptance gates (runnable)

```bash
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
cd /Users/nicholas/develop/browser-life-i06-free-energy-matched
pnpm install
pnpm typecheck
pnpm vitest run --maxWorkers=2 packages/runner/test/niche-*.test.ts tools/test/niche-*.test.ts apps/lab/test/niche-*.test.ts
node tools/niche/niche.ts --rung fe --bench                 # step rate, informational (pace if load > 40)
node tools/niche/niche.ts --rung fe --calibrate             # dev + wall + dose ladder only; writes calibration.json
node tools/niche/niche.ts --rung fe --freeze                # lock written; then the freeze commit and push (section 9)
node tools/niche/niche.ts --rung fe --write                 # once; ALWAYS seals a payload (stopped payload if no candidate qualifies; fresh seeds simulated only for qualifying candidates)
node tools/niche/niche.ts --rung fe --check
node tools/niche/niche.ts --rung fe --replay-check
node tools/niche/niche.ts --check && node tools/niche/niche.ts --replay-check   # rung 1 still byte-identical (G7)
pnpm vitest run --maxWorkers=2 packages/sim-ref/test/golden-hashes.test.ts
git diff --exit-code origin/main -- packages/schema packages/sim-ref packages/sim-gpu vendor experiments/preregistration.md experiments/FROZEN docs/rules.md
git diff --name-only origin/main -- docs/niche-construction-2026-11-01   # must list only manifest.json
```
Gates: G1 comparator and ledger tests green, exact zero residual per arm and replicate; G2 fixtures behave as stated (far-field-energy fools `D_inoc` and not `D_inoc2`); G3 per candidate, ordinary-placement dev positive control passes at a dose within its ceiling, else that candidate stops with the minimum detectable dose and no fresh run; G-NOISE per candidate `delta_c` at most half the limiting-contrast control effect; G4 freeze (hash, seeds, amendment, source hashes) committed and pushed before any fresh seed is read, enforced in code (section 9); G5 `--check` and `--replay-check` pass; G6 regeneration budget (full workload, benchmarked with `--bench` before freeze; 3.7 ms/step unloaded): per block `2*T1 + 13 arms * R * T2` = 4,280 steps at R = 4 (about 16 s). Dev candidates 8 blocks x 3 = 24 blocks (about 6.5 min); replicate-noise ensemble about 1 min; wall ladder with stop-at-first-pass, 2 walls x up to 3 doses (60, 120, 240 as the ceiling needs) x 8 seeds x 12 arms x R x 80 = about 184,000 steps worst case (about 11 min; fewer on early passes); fixtures about 1 min; fresh 16 x 3 = 48 blocks (about 13 min). Calibration is run once and reused: `--write` loads the frozen `calibration.json` (verified against the lock) and does not re-derive it. Sum about 35-40 min unloaded, about 80 min at 2x load, plus replay-check (about 13 min); target under 2 hours including reviews, pace if load > 40 (it is above 60 at plan time), and cut scope in this order if the benchmark overruns: page extras, fixture variants, W1 wall; never the comparators, the control or the freeze; G7 rung-1 evidence, calibration and lock byte-identical; only its manifest re-pinned; rung-1 `--check` and `--replay-check` pass; G8 page screenshot spec passes at both widths and the PNGs are read.

## 9. Freeze-before-run sequence (IMPLEMENT stage)

1. Implement, unit tests green, dev `--calibrate`; fix the dev-set free parameters (`delta_c`, ceilings and dose rungs, R).
2. Write the dated amendment (section 10, filled with the frozen numbers), `--freeze` to write `protocol.lock.json`, Codex Sol 6.1 review of the freeze (design, seeds, rules), address findings.
3. Commit only the freeze set (code, PLAN, amendment, registry, `calibration.json`, `protocol.lock.json`; no `evidence.json`, `manifest.json`, `EVIDENCE.md`, page data), push `claude/i06-free-energy-matched`, no PR.
4. **Enforced guard.** The rung-fe lock binds protocol, calibration, enumerated seeds, registry digest **and the hashes of every niche source file**. `--write` and `--replay-check` (every path that can simulate fresh seeds) first verify: the lock verifies against current protocol, calibration and sources; the frozen files in the working tree are clean against HEAD; and `git ls-tree origin/claude/i06-free-energy-matched` shows the same lock and frozen sources (pushed freeze). Otherwise they refuse before reading any fresh seed. A guard test stubs git for refuse and allow cases. The lock cannot name its own commit; the pushed-identical check is the ordering proof.
5. Run `--write` (fresh seeds; seals a stopped payload instead if no candidate qualifies), `--check`, `--replay-check`, page and screenshots, write `EVIDENCE.md` from the evidence. Later fixes never edit the frozen rules; changes after the fresh read are recorded as a further amendment and the fresh seeds are then spent.

## 10. Amendment 3 (dated 2026-11-02; written at freeze, before any fresh seed was read)

Rung-1 amendments 1 and 2 are the history this builds on (`docs/niche-construction-2026-11-01/PLAN.md` section 10). Dev calibration was run once (`calibration.json`, log `calibrate.log`) on dev seeds 8601001-008, replicate-noise 8601201-204 and wall seeds 8601301-308. What it fixed, and what changed relative to sections 4 and 5:

- **R = 4**, replicate stride 1000. The replicate-noise control compares replicate set A (offsets 0-3) with a disjoint set B (offsets 4-7) for the builder-removed and the nonbuilder-removed arm, so R is capped at 4 inside the reserved offsets; R = 8 would need a wider registry reservation first. The one allowed escalation to R = 8 was not taken: the wall effects on dev (below) are 10-40 times smaller than the measured floor and zero on most contrasts, so a factor of about sqrt(2) in noise cannot close them.
- **delta per candidate (summed-R units)**: cluster 0: 1152, cluster 4: 1031, cluster 9: 1169 (`max(ceil(B_r * R / 50), ceil(1.5 * max|D|))` over 8 replicate pairs per candidate). Rung 1 had 341 / 291 / 404 for a single sim; divided by R the new floors are 288 / 258 / 292, so the sum of four sims lowered the floor (relative to a single sim) by only 15.5%, 11.4% and 27.7%, not enough.
- **Realistic ceilings** (2 x the median dev builder polymer at T1, the twice-median integer): cluster 0: 200, cluster 4: 204, cluster 9: 169. The ladder 60, 120, 240, 600, 1200 therefore admits 60 and 120 for every candidate, not 240.
- **W2 (polymer floor under the receiver) is unavailable by construction**: ordinary placement requires empty cells and W2 puts polymer on every footprint cell (0 common placeable cells; the probe is part of the evidence). W1 (ring around the footprint) is the only ordinary-placement geometry and is the one control.
- **W1 on dev (8 wall seeds, four gating contrasts including inoc2)**: no dose on the ladder passes. Seeds positive per contrast: dose 60: 4/8 on builder, poly, inoc2; 4/8 on space; dose 120: 4/8, 4/8, 6/8 (space median +27.5), 4/8; dose 240: 5/8, 5/8, 7/8 (space median +29.5), 5/8; dose 600 and 1200 are worse than the comparators (medians about -172 and -190). So the minimum detectable dose does not exist on this ladder (up to 1200, about 6 times the ceiling), the noise gate cannot be met either (it needs the weakest contrast median to be at least twice delta, i.e. above about 2,060 to 2,340; the best weakest-contrast median observed is 1.5), and **all three candidates are `unsupported-measurement` with the stated reason that no ordinary-placement wall is detectable at any tested dose**. (The best weakest-contrast median over the whole ladder is +1.5, at dose 240 and above every ceiling; the best single contrast, space, reaches +29.5 there.) No fresh block is simulated; `--write` seals a stopped payload (fixtures and the frozen calibration only).
- Seeds: block, replicate (primary and noise offsets), wall and fixture seeds are enumerated in the protocol (the lock lists every seed that can run: 8,601,001-8,608,999 only); never 8600101-108 or 8600501-508. Fresh seeds 8601501-516 are listed in the protocol and never read, because no candidate qualified.
- Registry binding: this rung digests its own single reservation line (owner `i06b free-energy-matched`); the first rung's `LATER_SLICE_OWNERS` skips it, so neither rung's evidence depends on the other's reservation. The first rung's manifest.json is re-pinned (source hashes only).
- Dev contrasts for the record: `inoc2` was negative in 24 of 24 dev blocks and equalled `inoc` in all 24, because its maximum retains the first rung's d1E and d1B (`inoc2 <= inoc` by construction), so this is not evidence about the matching itself. The matched-only contrast `inocMatched = Y(b) - max(fU, fS, fB)` (reported, never gating; added at freeze after the Codex freeze review) was zero or negative in 21 of 24 dev blocks and positive in 3. The free-energy gap is real (receiver-alone holds about 19,900 free E against the field arm's about 9,400 at equal total) and is closed by fU/fS/fB exactly.

Fresh seeds are read only after this amendment, the lock, the calibration and the sources are committed and pushed (`freezeGuard`); with no qualifying candidate the fresh seeds are never read at all.

Corrections made at freeze after the Codex Sol 6.1 xhigh freeze review (`freeze-review-raw.txt`, `REVIEW.md`): the guard asks the remote (`git ls-remote`) instead of trusting a local tracking ref and lives inside the generator itself; PLAN.md joins the lock and the pushed-identical set; the power statement no longer claims an exclusion bound (a negative is a failure to detect, and the Holm threshold is 13 of 16 with three candidates, 12 with one); the ladder stop rule continues past a dose that passes the wall rule but fails G-NOISE while a within-ceiling dose could still qualify (calibration re-run: byte-identical apart from the new reported `inocMatched` field); fB is described relative to fS (it holds `(eB - eA) * dB` more total energy than fS) with its gap to b recorded with its sign; the numbers above were recomputed from `calibration.json`.

## 11. Non-goals and limits

- Not a new organism, predation, or mutation test; one receiver genome, one field per candidate, T1 = 60, T2 = 80, 24x24, single tile.
- Free energy cannot be matched together with total energy at equal matter; reporting both families and the signed `constructionGap` is the honest alternative. A pass shows no more than the power statement in 4.2 allows.
- The positive control is a hand-built wall under ordinary placement; it shows the assay can detect a polymer structure of realistic dose, not that a builder's field can pass. The builder founder-biomass dose-response and a polymer-bearing full-gate trap fixture are cut from this rung and left to a later one. A failed control is a finding about assay sensitivity, not about niche construction.
- Sum-of-R readout reduces replicate noise, not block-to-block field variance; the block count carries that.
- No GPU evidence, no deploy, no edits to frozen preregistration, rung-1 evidence stays sealed and unedited (rung 1's own conclusion is superseded only by a rung-2 label, not rewritten).
- Not part of the frozen preregistration; exploratory.

## 12. How to try it

```bash
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
cd /Users/nicholas/develop/browser-life-i06-free-energy-matched && pnpm install
pnpm dev -- --port 5341 --strictPort
# open http://localhost:5341/niche/  (scroll to "Second rung: free-energy-matched")
node tools/niche/niche.ts --rung fe --check          # verifies the sealed second-rung evidence without simulating
node tools/niche/niche.ts --rung fe --replay-check   # regenerates and compares bytes
BL_E2E_PORT=5351 npx playwright test tests/e2e/niche-fe.spec.ts --project=chrome   # screenshots under test-results/
```
What a person sees: per comparator the free energy and total energy before and after matching, the noise floor next to the effect it must detect, the dose ladder of the positive control (pass or the minimum detectable dose), each candidate's edge as supported, unsupported or unavailable, and the `far-field-energy` panel showing the naive metric and the old comparators fooled while the new ones are not.
