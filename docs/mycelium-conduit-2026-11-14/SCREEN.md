# Mycelium conduit screen (14 Nov 2026)

Label: EXPLORATION, not a test. No pre-registration, 4 seeds per cell, no noise floor, no multiplicity control. Plan: `DESIGN.md` (kernel rule V1, readouts, section 7 outcomes fixed before any run). Runner `tools/mycelium/conduit-screen.ts`, readouts `tools/mycelium/observe-conduit.ts` (R4's `r4Census` and R2b's observer are imported unchanged). Raw outputs `runs/mycelium-conduit/main/runs/<arm>.<heredity>.<slot>.json` (series, windows, branch; gitignored), one line per start, finish or failure in `run-log.jsonl` (this folder, nothing dropped), the 26 smoke runs (2 at 2,000 steps, 24 at 5,000 steps, outputs deleted) are in the same log under `out` `smoke-*`.

## Result in one paragraph

V1 (trail conduit) is **PURGED at every strength**: inherit with conduit keeps trail (late trail per particle at least 0.1) in at most 1 of 4 seeds at g = 2, 8, 32 and 128, and the one seed that keeps (8102, 0.08 to 0.44 per particle, against 98 to 100 under the toll rule) is not dose-ordered and also shows at the uniform-diffusion control and at the keyless `moveCost` 12 baseline. The conduit-off branch changes births by 0 to 1 percent in inherit worlds, by 2 to 10 percent upward in the physarum and blind anchors, and by about -9 to +7 percent (noise-sized) in blocked worlds. Nothing here warrants a pre-registered rung. The V2 trigger (DESIGN section 9) does not fire. With about 4 seeds and no pre-registration this only says that a rung on this rule is not warranted, not that no conduit-like rule can work.

## Setup

- Run: 128 x 128, **100,000 steps**, `defaultConfig()` plus the arm's delta; late window (50k, 100k], early (10k, 20k]. Both ledgers (matter, energy) and `validateState` on the full state every 100 steps: **100 of 100 runs exact, 100,000 of 100,000 checks, plus the branch's 200 + 200 steps per conduit run**; no run failed. GPU (`GpuMycelium`, native WebGPU via Deno), 2 processes x 3 jobs.
- Arms (DESIGN section 6): `base` (keyless; inherit, blocked, physarum follower with `physarumDeposit` 256, blind = that follower with `blindTrailGradient`), `diffA56/80/104` (uniform-diffusion bracket, inherit), `c2`, `c8`, `c32` (and `c8` also physarum and blind anchors), `g-base` and `g-c8` (gradient light), `mc12-base` and `toll-ref` (`moveCost` 12, `trailMoveDiscount` 64, toll; the optional reference pair). Plus `c128`, see deviations. 100 runs: 4 slots x 25 (heredity, arm) cells.
- Heredity arms and configs are R4's (`r4-protocol.ts`): physarum is `heredity frozen, controller physarum, physarumDeposit 256`, blind adds `blindTrailGradient`.
- **Seeds.** World seed = slot + heredity offset, slots 8101-8104 (inherit +0, blocked +200, physarum +400, blind +600; 8101-8104, 8301-8304, 8501-8504, 8701-8704). Slots 8105-8108 are held for the extension to 8 seeds and were not used (no strength came out INCONCLUSIVE). Arms of the same heredity share a world seed (paired worlds across strengths). Audit, printed by `deno run -A --no-lock tools/mycelium/conduit-screen.ts --audit` and re-run by the runner at start (exit 2 on any problem):

```
R2b worlds (slots 2001-2020, 5001-5016 plus arm offsets): 216 seeds, 0 collisions
R2 seeds (101-105, 9001-9005): 10 seeds, 0 collisions
R3 worlds: 162 seeds, 0 collisions
R4 worlds: 180 seeds, 0 collisions
trail-use screen run-log worldSeeds: 8 seeds, 0 collisions
run.ts gates (seed < 9001 and embargoReason null) refuse 0 of 32 screen world seeds
screen world seeds (32): inherit 8101..8108; blocked 8301..8308; physarum 8501..8508; blind 8701..8708
```

- Readouts. From `observe-r2b.ts`/`observe-r4.ts`: TM (trail per particle), d (deposit measure), n, median age (AGE), ALIGN (`align`), `acute`, OCC (`occ`, `occShift`), `speed`. From `observe-conduit.ts` (design readouts 1 to 6): `csat`, `csatCap`, effective conductance `eff` percentiles, trail per occupied cell, **flow** = `imp` (rotation-averaged net extra import per particle, layers against non-layers, `x >= 32` against below), connectivity, `occx` (residence on conductance), the level and nutrient lesions `sensLevel` and `sensNut` (in situ `probeLesion`), and the **conduit-off branch** (causal): at the step-100,000 state, 200 steps on the continuing object and 200 on a fresh `GpuMycelium` with both conduit keys stripped; births per particle-step and aggregate A intake (`sum A + dLightIn/eA - sum A`, checked exact on a CPU run in `tools/test/mycelium-observe-conduit.test.ts`).
- For keyless and toll rows (`base`, `diffA*`, `g-base`, `mc12-base`, `toll-ref`) the conduit readouts are **HYPOTHETICAL**, taken at g = 8 on that world's own trail and nutrient: what a conduit of that strength would offer there, not anything the world did, and the branch is not taken (no conduit to switch off), so flow and branch are blank or structurally zero in those rows. In `c*` and `g-c8` rows they describe the rule the world ran.
- Pre-run gates: `tests/deno/mycelium_gpu.ts` rerun with the exit code kept: **exit 0, "all 69 cases match bit for bit"** (about 5 minutes); `pnpm typecheck` clean; observer unit tests (6) pass.

## Deviations from DESIGN.md (all decided before looking at any late-window result)

1. **Seeds 8101-8108** with offsets 0/200/400/600 instead of the design's 300001+ (the task's seed rule; every world seed stays below `FRESH_MIN` 9001, so `run.ts` would also accept it).
2. **Sizing step 0** was read from the base arm's own (10k, 20k] window rather than separate 20,000-step runs (identical prefix). Result: keyless inherit worlds hold **0 trail at the median and 90th percentile of occupied cells** in the early window, keyless blocked a median of 0 and p90 of 3, so at g from 2 to 32 the median occupied-cell `eff` is 0 (below the design's 5 percent of the 88 headroom) for the whole range in neural worlds; the physarum follower's worlds (median `x` 0 to 18, `eff` p90 about 58 at g = 8 for the filament follower, p50 9 for the blind follower) are the only ones inside the band. The design's rule says move g. I did it once, by **adding one stronger arm c128** (inherit and blocked, 8 runs) and keeping 2, 8, 32 as planned; the keyless-inherit runs, the diffA bracket (56, 80, 104: median realised `Dd` of c8 is 40 in neural worlds, 49 in the follower's, so the bracket was not moved) are as planned. c128's dose condition (e) is evaluated in the form `m(c128) >= 0.8 m(c32)`, a post hoc extension.
3. The optional toll reference pair (`mc12-base`, `toll-ref`) was run.
4. The tables show the late window as the second half of each run (identical to (50k, 100k] here).
5. A Sol 6.1 High read-only review of the two new files (before the main run) found no defect in the census formulas, the stripped branch config, the denominators or the intake identity, and five operational points: resume validation, claim cleanup after failures, `--steps` not a multiple of 500, table window labels, and "seed schedule differs from the design" (deliberate, item 1). The first, second, third and fourth were fixed (after the `base`, `g-base` and `mc12-base` runs had started; the edits touch resume and labels, not simulation or readouts).


## Reading, in plain language

- **Keyless references.** Without conduit, inherit worlds purge trail (0 of 4 kept at default `moveCost`, 1 of 4 at `moveCost` 12, with trail per particle at 0.00 to 0.13); blocked worlds hold about 2 per particle by drift (the survival-selected comparator); the physarum follower holds about 99 and ALIGN 0.99, OCC 7.7; blind holds the same trail with ALIGN 0 and OCC 1.5. The uniform-diffusion bracket (diffA 56, 80, 104) keeps trail in 0 of 4 seeds at each value (condition (f) holds).
- **Toll reference.** The toll rule (R4) keeps trail everywhere (99.6 per particle at the median, 4 of 4 inherit seeds) with ALIGN at or below zero and OCC about 1.05: it keeps trail without anything following it, as R4 found. That is the contrast: the conduit rule does not even keep the trail.
- **Conduit.** Inherit worlds with conduit purge as the keyless ones do. Late trail per particle per seed: c2 0.00/0.19/0.00/0.00, c8 0.00/0.16/0.00/0.00, c32 0.00/0.08/0.00/0.00, c128 0.00/0.44/0.00/0.00. Seed 8102 is the only one that holds a little (and holds it under four strengths and, at 0.08, under diffA 56, and at 0.13 under keyless `moveCost` 12), so it is most likely a property of that world rather than of the conduit (the keyless base and diffA 80 and 104 give 0.00 there, so a weak conduit effect in that one world is not excluded; with 4 seeds it cannot be separated); there is no dose ordering. In the early window conduit worlds hold a little more trail than keyless ones (medians 0.04 to 0.08) but so do the uniform-diffusion controls (medians 0.02 to 0.06) against 0.01 for keyless base, and all of it is gone by the late window. Under 4 seeds, with the controls inside the conduit range, this is not a conduit-specific effect (see the Skeptic check).
- **Why, as far as the data show.** The conduit only conducts across an edge whose two cells both hold trail, so a first layer in bare ground gets nothing for its deposit cost, and in these worlds trail is 0 to 3 per occupied cell (blocked, p90 about 3), where `eff` is almost always zero. Even where trail is plentiful it does not pay: in the physarum and blind worlds (trail 30 to 113 per occupied cell, `eff` p90 19 to 58) switching the conduit off raises births by 2 to 5 percent (physarum) and 6 to 10 percent (blind) over the next 200 steps, consistently over 4 of 4 seeds in each: births per particle are higher with the conduit off, but so are deaths (blind: deaths +6 to 10 percent, mean population 1.5 percent lower off, 4 of 4 seeds), and intake per particle differs by under 0.5 percent: the rule damps turnover and does not here make nutrient more available. For blocked worlds (trail about 2 per particle) the branch difference runs from -9 to +7 percent across seeds and strengths with no consistent sign, including g = 128. The flow readout `imp` is positive for layers (0.03 per step at g = 128 in blocked worlds, against 0.01 for non-layers), but where it exists the branch shows no gain. The use lesions are 0.0000 to 0.0003 (level) and 0.002 to 0.004 (nutrient) in every neural run at default `moveCost`, equal to the blocked and keyless values; the `moveCost` 12 rows (mc12-base, toll-ref) are higher (level 0.006 to 0.020, hypothetical or not), as the tables show.
- **Saturation** is not the failure here: `csat` and `csatCap` are 0.00 in every conduit run (the R4 carpet did not recur, the opposite problem: no trail at all).
- **Gradient light** (g-base, g-c8): inherit keeps trail in at most 1 of 4 seeds in both (g-base 1 of 4 with 1.19 per particle in seed 8101 and 0.02 to 0.05 in the others, g-c8 0 of 4 at the 0.1 bar, best 0.09), blocked holds 3.2 to 4.0; the gradient does not rescue the rule.

## Section 7 labels (per strength)

The label code is `--label`, the predicates are the design's, with k of 4 seeds and "at least 3 of 4" scaled as `ceil(0.75 n)`. K counts a seed as kept at late trail per particle at least 0.1. Because K is at most 1 of 4 everywhere, (a) to (d) are evaluated only on the kept seed and do not enter the label.

Physarum anchor acute (median over the base-arm physarum runs): 0.9907

(f) control, uniform diffusion bracket kept: diffA56 0/4, diffA80 0/4, diffA104 0/4 -> holds
keyless inherit (base) kept: 0/4

| strength | seeds | K | (a) branch | (b) import | (c) behaviour (H and G) | H without G | (d) unsaturated | (e) dose | label |
|---|---|---|---|---|---|---|---|---|---|
| c2 | 4 | 1/4 | 0 | 0 | 0 | 0 | 1 | yes | PURGED |
| c8 | 4 | 1/4 | 0 | 0 | 0 | 0 | 1 | no | PURGED |
| c32 | 4 | 0/4 | 0 | 0 | 0 | 0 | 0 | yes | PURGED |
| c128 | 4 | 1/4 | 0 | 1 | 0 | 0 | 1 | no (post hoc form) | PURGED |

Per seed (inherit runs): K, a, b, c(H,G), d, and which H branch.

| run | K | a | b | H | G | d | H via occx/sens/acute |
|---|---|---|---|---|---|---|---|
| c2.inherit.8101 | n | n | n | n | y | y | n/n/n |
| c2.inherit.8102 | y | n | n | n | y | y | n/n/n |
| c2.inherit.8103 | n | n | n | n | n | y | n/n/n |
| c2.inherit.8104 | n | n | n | n | y | y | n/n/n |
| c8.inherit.8101 | n | n | n | n | y | y | n/n/n |
| c8.inherit.8102 | y | n | n | n | y | y | n/n/n |
| c8.inherit.8103 | n | n | n | n | y | y | n/n/n |
| c8.inherit.8104 | n | n | n | n | y | y | n/n/n |
| c32.inherit.8101 | n | n | n | n | y | y | n/n/n |
| c32.inherit.8102 | n | n | n | n | y | y | n/n/n |
| c32.inherit.8103 | n | n | n | n | y | y | n/n/n |
| c32.inherit.8104 | n | n | n | n | y | y | n/n/n |
| c128.inherit.8101 | n | n | n | n | y | y | n/n/n |
| c128.inherit.8102 | y | n | y | n | y | y | n/n/n |
| c128.inherit.8103 | n | n | n | n | y | y | n/n/n |
| c128.inherit.8104 | n | n | n | n | y | y | n/n/n |


**V2 trigger (DESIGN section 9):** V1 is PURGED, so V2 (hungry reach) is not built; the design sends the line to an owner plane or stops ("a public good that is purged at the pool level is not rescued by moving the delivery").

## Candidate and primary endpoint

**No candidate for a pre-registered rung.** If a successor variant (the design's owner-weighted conduction, where only the depositor's own trail conducts, or a variant that gives the first layer a return) were screened and came out KEPT-AND-USED, the primary endpoint of its rung would be **late trail per particle of inherit against the matched keyless inherit baseline, as the count of kept seeds** (the screen's K, which here is 0 to 1 of 4 against 0 to 1 of 4), because retention is the readout that the conduit, the discount and every earlier screen have separated on; the use readouts (`acute` against the physarum anchor, `occx` against `occxShift`, the conduit-off branch's birth rate) would be secondary and conditional on retention, in R4's shape (physarum anchor, blind negative, ghost control).

## What this does and does not say

About 4 seeds per cell, no pre-registration, one 200-step branch per run, one conduit form (symmetric conductance across trail-trail edges, public). It suggests only that a pre-registered rung on this rule is not warranted. It does not say that the conduit cannot help a strongly trail-laying population (the physarum worlds were not selected for it), or that other forms (owner plane, a deposit return, a lower retention bar) could not work.

## Skeptic check (independent recomputation, 14 Nov 2026)

Method: a separate Python pass (`-I`) over the 100 raw files in `runs/mycelium-conduit/main/runs/` and `run-log.jsonl`, not the Deno table code.

Checked and confirmed: 100 files, 100 started and 100 finished lines in the main log, no duplicate, failed or orphan ids; every file's `ledgerChecks` equals the log's and 100,000 of 100,000 checks have residual 0 (branch `ledgerBad` 0 on both sides in every branched run); every run is 100,000 steps; world seed = slot + offset in all 100 files and config deltas against base are exactly the arm's keys (nothing else differs); 16 distinct world seeds, 8101-8104/8301-8304/8501-8504/8701-8704, none in the logged R2/R2b/R3/R4/trail-use seed sets (audit rerun: 0 collisions, `run.ts` refuses none; no earlier docs run-log or evidence file uses a seed 8101-8108, 8301-8308, 8501-8508 or 8701-8708). Every per-seed late TM, kept count, medians of d, n, ALIGN, acute, OCC, early TM, the physarum anchor acute (0.9907), the branch births on/off per 1000 particle-steps (c2, c8, c32, c128, g-c8; relative drop per seed), `imp` layer/non-layer, toll-ref per-seed ALIGN/acute/OCC, and the label table's K counts reproduce. The sizing numbers (keyless inherit 0 and 0 at p50/p90, blocked p90 3, physarum `eff` p90 57.9, blind `eff` p50 9) reproduce.

Corrections made above: the smoke-run count (26, not 12); the early-window comparison (the diffusion controls' early medians are 0.022, 0.059 and 0.038, not 0.005 to 0.008, so conduit and diffusion arms overlap and the "slowed purge" hint is not conduit-specific; the conduit range is 0.037 to 0.077, not 0.02 to 0.08); the opening paragraph's "zero to a few percent" branch change (2 to 10 percent in the anchors); the lesion sentence (not true for the `moveCost` 12 rows, and nutrient reaches 0.004); "a property of that world, not of the conduit" softened; the "does not help" sentence now carries the deaths and population facts below.

What the reading rests on, and where it is weaker than the headline:

1. **Floor effect (the R4 failure again, in another form).** In all 16 inherit conduit runs `eff` p90 is 0 and p90 trail per occupied cell is 0, and only 0 to 27 of 4,700 to 6,100 particles are depositing layers (seed 8102 only; the other seeds have 0 in the late window). So the conduit essentially never operated in the evolving neural worlds. PURGED at every strength is correct as stated, but what was tested is whether a conduit can bootstrap trail from none, not whether a connected trail pays under inheritance. The only worlds where the conduit had trail to conduct across are the physarum and blind anchors, which are frozen followers and cannot show retention. A screen that starts with a laid trail (or removes the deposit cost for the first layer) would be the test of use; this one cannot reject it.
2. **Birth rate alone is one-sided.** In the blind anchor the conduit-off branch has more births per particle (+6 to 10 percent) and also more deaths (+6 to 10 percent), with the mean population 1.5 percent lower off in 4 of 4 seeds and intake per particle within 0.5 percent. In physarum births are +2 to 5 percent, deaths +1 to 3 percent, population equal. So the conduit damps turnover; it does not raise births, and whether damped turnover is a fitness benefit is not established. The 200-step branch has 200 to 280 births in blocked worlds (Poisson sd about 7 percent per side), so the blocked range of -9 to +7 percent is the size noise predicts.
3. **Presence versus use.** `occx`, `acute` and ALIGN are at the keyless values in every neural arm, so nothing resembling use was seen; but with item 1 the conduit gave no gradient to follow, so this is not evidence that use would not evolve if a trail were present.
4. **Population size does not explain keeping.** Seed 8103 holds 5,600 to 6,100 particles in every arm and keeps no trail; seed 8102 is 4,840 to 5,480 in keyless and diffusion arms and about 6,000 (6,037, 6,082, 5,994, 6,060) at all four conduit strengths together with its trace of trail. Across the 36 keyless/diffusion/conduit/mc12 inherit runs the correlation of N with late TM is 0.41, driven by that one world. The uniform 20 percent rise at all four strengths in 8102 only is the one place a conduit effect could hide; one world cannot say.
5. **Kept counts.** Conduit arms 3 of 16 kept (c2, c8, c128; c32 is 0.08, 0.02 under the bar) against 0 of 16 for keyless base plus diffusion controls (and 1 of 4 at `moveCost` 12). One-sided Fisher p is 0.11 (two-sided 0.23), and the 16 runs are 4 worlds, so this is no evidence either way; PURGED holds by the design's rule (K at most floor(n/4)) with every strength at the rule's limit or below.
6. **Dose column (e)** compares medians that are all below 0.001 (the median of 0, 0.19, 0, 0), so "yes/no" there is floating-point dust; it does not enter any label.

Verdict of the check: the numbers hold and PURGED at every strength stands; "does not even keep the trail" and "nothing warrants a rung" hold only for a conduit that starts from zero trail. Nothing here shows that a connected trail would not be kept and used.

## Runtime and files

100 runs of 100,000 steps took 32 minutes wall (13:25:41 to 13:57:37 UTC, 2 processes x 3 jobs, about 110 s per run when 6 run together, 183 job-minutes), plus 5 minutes for the parity rerun. Raw: `runs/mycelium-conduit/main/runs/*.json` (100 files). Log: `docs/mycelium-conduit-2026-11-14/run-log.jsonl`. Code: `tools/mycelium/conduit-screen.ts`, `tools/mycelium/observe-conduit.ts`, `tools/test/mycelium-observe-conduit.test.ts`. Rebuild the tables below with `deno run -A --no-lock tools/mycelium/conduit-screen.ts --out runs/mycelium-conduit/main --table` and the labels with `--label`.

The kernel (`world.ts`, `gpu.ts`, `RULES.md`) was edited for this line, so its hashes no longer match the R2 to R4 freezes; those rungs stay reproducible at their commits (R2b `edc25af9`, R3 `eef9c043`, R4 `88bd3002`), and the pinned digest `9a5461c07ef6fcde` still holds (asserted in `mycelium.test.ts` and `mycelium-conduit.test.ts`).

## Tables (generated)

Per arm and heredity: values are window means over the heavy (500-step) or scalar (100-step) censuses; per-seed values in slot order; medians over seeds. Late = (steps/2, steps] (the second half of each run), early = (10k, 20k].

### base

| heredity | seeds | TM early | TM late (per seed) | TM late med | kept | d late | n late | age late | ALIGN | acute | OCC (occShift) | speed | ledger |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 4 | 0.010 | 0.00 / 0.00 / 0.00 / 0.00 | 0.000 | 0/4 | 0.0000 | 4884 | 1440 | -0.001 | 0.000 | 1.00 (1.00) | 0.425 | 4000/4000 exact |
| blocked | 4 | 2.896 | 2.01 / 2.30 / 2.02 / 1.90 | 2.014 | 4/4 | 0.0204 | 4714 | 59920 | -0.020 | 0.000 | 1.06 (1.00) | 0.286 | 4000/4000 exact |
| physarum | 4 | 98.824 | 98.87 / 98.85 / 98.85 / 98.82 | 98.850 | 4/4 | 0.9978 | 2229 | 523 | 0.992 | 0.991 | 7.72 (1.00) | 0.395 | 4000/4000 exact |
| blind | 4 | 98.718 | 98.75 / 98.72 / 98.75 / 98.72 | 98.736 | 4/4 | 0.9966 | 3624 | 294 | 0.000 | 0.000 | 1.52 (1.00) | 0.259 | 4000/4000 exact |

Conduit readouts (late window; HYPOTHETICAL g=8: what a conduit of that strength would offer on this world's own trail, not a rule the world ran):

| heredity | csat | csatCap | eff p10/p50/p90 | trail per occupied cell p10/p50/p90 | imp layer / non-layer | imp x>=32 / x<32 | connShare / largest | occx (shift) | sensLevel / sensNut | branch births on/off per 1000 particle-steps | branch intake on/off |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 0.000 | 0.000 | 0.0/0.0/0.0 | 0.0/0.0/0.0 | - / 0.0000 | - / 0.0000 | - / 0 | 1.00 (1.00) | 0.0000 / 0.0018 | - | - |
| blocked | 0.000 | 0.000 | 0.0/0.0/0.0 | 0.0/0.0/2.0 | 0.0012 / 0.0003 | - / 0.0004 | 0.118 / 1 | 1.06 (0.99) | 0.0002 / 0.0018 | - | - |
| physarum | 0.000 | 0.000 | 0.0/0.0/57.5 | 60.8/112.5/131.4 | -0.0133 / - | -0.0132 / - | 1.000 / 5 | 7.49 (1.01) | 0.0000 / 0.0000 | - | - |
| blind | 0.000 | 0.000 | 2.0/9.0/18.7 | 11.4/30.5/56.1 | 0.1327 / - | 0.1870 / 0.0908 | 0.992 / 8479 | 1.41 (1.00) | 0.0000 / 0.0000 | - | - |

### diffA56

| heredity | seeds | TM early | TM late (per seed) | TM late med | kept | d late | n late | age late | ALIGN | acute | OCC (occShift) | speed | ledger |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 4 | 0.022 | 0.00 / 0.08 / 0.00 / 0.00 | 0.001 | 0/4 | 0.0000 | 4965 | 1252 | 0.000 | -0.000 | 1.00 (1.00) | 0.426 | 4000/4000 exact |

Conduit readouts (late window; HYPOTHETICAL g=8: what a conduit of that strength would offer on this world's own trail, not a rule the world ran):

| heredity | csat | csatCap | eff p10/p50/p90 | trail per occupied cell p10/p50/p90 | imp layer / non-layer | imp x>=32 / x<32 | connShare / largest | occx (shift) | sensLevel / sensNut | branch births on/off per 1000 particle-steps | branch intake on/off |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 0.000 | 0.000 | 0.0/0.0/0.0 | 0.0/0.0/0.0 | - / 0.0000 | - / 0.0000 | - / 0 | 1.00 (1.00) | 0.0000 / 0.0018 | - | - |

### diffA80

| heredity | seeds | TM early | TM late (per seed) | TM late med | kept | d late | n late | age late | ALIGN | acute | OCC (occShift) | speed | ledger |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 4 | 0.059 | 0.00 / 0.00 / 0.00 / 0.00 | 0.002 | 0/4 | 0.0000 | 4892 | 1476 | 0.006 | -0.000 | 1.00 (1.00) | 0.407 | 4000/4000 exact |

Conduit readouts (late window; HYPOTHETICAL g=8: what a conduit of that strength would offer on this world's own trail, not a rule the world ran):

| heredity | csat | csatCap | eff p10/p50/p90 | trail per occupied cell p10/p50/p90 | imp layer / non-layer | imp x>=32 / x<32 | connShare / largest | occx (shift) | sensLevel / sensNut | branch births on/off per 1000 particle-steps | branch intake on/off |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 0.000 | 0.000 | 0.0/0.0/0.0 | 0.0/0.0/0.0 | - / 0.0000 | - / 0.0000 | - / 0 | 1.00 (0.99) | 0.0000 / 0.0013 | - | - |

### diffA104

| heredity | seeds | TM early | TM late (per seed) | TM late med | kept | d late | n late | age late | ALIGN | acute | OCC (occShift) | speed | ledger |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 4 | 0.038 | 0.00 / 0.00 / 0.00 / 0.06 | 0.002 | 0/4 | 0.0000 | 5448 | 2527 | -0.008 | -0.000 | 1.03 (1.00) | 0.212 | 4000/4000 exact |

Conduit readouts (late window; HYPOTHETICAL g=8: what a conduit of that strength would offer on this world's own trail, not a rule the world ran):

| heredity | csat | csatCap | eff p10/p50/p90 | trail per occupied cell p10/p50/p90 | imp layer / non-layer | imp x>=32 / x<32 | connShare / largest | occx (shift) | sensLevel / sensNut | branch births on/off per 1000 particle-steps | branch intake on/off |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 0.000 | 0.000 | 0.0/0.0/0.0 | 0.0/0.0/0.0 | - / 0.0000 | - / 0.0000 | 0.000 / 0 | 1.02 (1.01) | 0.0000 / 0.0013 | - | - |

### c2

| heredity | seeds | TM early | TM late (per seed) | TM late med | kept | d late | n late | age late | ALIGN | acute | OCC (occShift) | speed | ledger |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 4 | 0.037 | 0.00 / 0.19 / 0.00 / 0.00 | 0.000 | 1/4 | 0.0000 | 5402 | 822 | -0.004 | -0.000 | 1.02 (1.00) | 0.280 | 4000/4000 exact |
| blocked | 4 | 2.823 | 2.00 / 2.00 / 1.90 / 2.05 | 2.003 | 4/4 | 0.0203 | 4709 | 59512 | -0.020 | 0.000 | 1.06 (1.00) | 0.287 | 4000/4000 exact |

Conduit readouts (late window; the rule the world ran):

| heredity | csat | csatCap | eff p10/p50/p90 | trail per occupied cell p10/p50/p90 | imp layer / non-layer | imp x>=32 / x<32 | connShare / largest | occx (shift) | sensLevel / sensNut | branch births on/off per 1000 particle-steps | branch intake on/off |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 0.000 | 0.000 | 0.0/0.0/0.0 | 0.0/0.0/0.0 | 0.0000 / 0.0000 | - / 0.0000 | 0.000 / 0 | 1.00 (1.00) | 0.0000 / 0.0018 | 1.052 / 1.052 | 2.1267 / 2.1268 |
| blocked | 0.000 | 0.000 | 0.0/0.0/0.0 | 0.0/0.0/2.0 | 0.0000 / 0.0000 | - / 0.0000 | 0.110 / 1 | 1.15 (1.04) | 0.0002 / 0.0018 | 0.229 / 0.229 | 2.2923 / 2.2923 |

### c8

| heredity | seeds | TM early | TM late (per seed) | TM late med | kept | d late | n late | age late | ALIGN | acute | OCC (occShift) | speed | ledger |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 4 | 0.063 | 0.00 / 0.16 / 0.00 / 0.00 | 0.000 | 1/4 | 0.0000 | 5471 | 816 | 0.000 | -0.000 | 1.01 (0.99) | 0.323 | 4000/4000 exact |
| blocked | 4 | 2.846 | 1.88 / 1.98 / 1.93 / 1.84 | 1.908 | 4/4 | 0.0190 | 4708 | 59753 | -0.021 | 0.000 | 1.06 (1.00) | 0.288 | 4000/4000 exact |
| physarum | 4 | 98.867 | 98.83 / 98.84 / 98.86 / 98.86 | 98.850 | 4/4 | 0.9980 | 2227 | 550 | 0.992 | 0.993 | 7.73 (1.03) | 0.394 | 4000/4000 exact |
| blind | 4 | 98.715 | 98.73 / 98.76 / 98.75 / 98.76 | 98.755 | 4/4 | 0.9969 | 3663 | 317 | -0.000 | 0.000 | 1.53 (1.00) | 0.259 | 4000/4000 exact |

Conduit readouts (late window; the rule the world ran):

| heredity | csat | csatCap | eff p10/p50/p90 | trail per occupied cell p10/p50/p90 | imp layer / non-layer | imp x>=32 / x<32 | connShare / largest | occx (shift) | sensLevel / sensNut | branch births on/off per 1000 particle-steps | branch intake on/off |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 0.000 | 0.000 | 0.0/0.0/0.0 | 0.0/0.0/0.0 | 0.0013 / 0.0000 | - / 0.0000 | 0.000 / 0 | 1.00 (1.00) | 0.0000 / 0.0021 | 1.256 / 1.253 | 2.1352 / 2.1349 |
| blocked | 0.000 | 0.000 | 0.0/0.0/0.0 | 0.0/0.0/2.0 | 0.0012 / 0.0003 | - / 0.0003 | 0.130 / 1 | 1.07 (1.00) | 0.0002 / 0.0018 | 0.240 / 0.236 | 2.2952 / 2.2944 |
| physarum | 0.000 | 0.000 | 0.0/0.0/57.4 | 61.0/112.4/131.4 | -0.0127 / - | -0.0127 / - | 1.000 / 5 | 7.50 (1.03) | 0.0000 / 0.0000 | 1.194 / 1.237 | 2.6536 / 2.6529 |
| blind | 0.000 | 0.000 | 2.0/9.0/19.0 | 11.5/30.8/56.8 | 0.1115 / - | 0.1533 / 0.0778 | 0.992 / 8609 | 1.41 (1.00) | 0.0000 / 0.0000 | 2.048 / 2.232 | 2.4754 / 2.4721 |

### c32

| heredity | seeds | TM early | TM late (per seed) | TM late med | kept | d late | n late | age late | ALIGN | acute | OCC (occShift) | speed | ledger |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 4 | 0.055 | 0.00 / 0.08 / 0.00 / 0.00 | 0.000 | 0/4 | 0.0000 | 5271 | 862 | 0.000 | -0.000 | 1.00 (1.00) | 0.292 | 4000/4000 exact |
| blocked | 4 | 2.862 | 2.22 / 2.04 / 1.86 / 1.98 | 2.010 | 4/4 | 0.0202 | 4717 | 59431 | -0.021 | 0.000 | 1.06 (1.00) | 0.286 | 4000/4000 exact |

Conduit readouts (late window; the rule the world ran):

| heredity | csat | csatCap | eff p10/p50/p90 | trail per occupied cell p10/p50/p90 | imp layer / non-layer | imp x>=32 / x<32 | connShare / largest | occx (shift) | sensLevel / sensNut | branch births on/off per 1000 particle-steps | branch intake on/off |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 0.000 | 0.000 | 0.0/0.0/0.0 | 0.0/0.0/0.0 | 0.1155 / 0.0000 | - / 0.0000 | 0.840 / 0 | 1.00 (1.00) | 0.0000 / 0.0023 | 1.067 / 1.071 | 2.1384 / 2.1380 |
| blocked | 0.000 | 0.000 | 0.0/0.0/2.0 | 0.0/0.0/2.0 | 0.0076 / 0.0028 | - / 0.0029 | 0.135 / 1 | 1.05 (1.00) | 0.0002 / 0.0018 | 0.240 / 0.233 | 2.2921 / 2.2924 |

### c128

| heredity | seeds | TM early | TM late (per seed) | TM late med | kept | d late | n late | age late | ALIGN | acute | OCC (occShift) | speed | ledger |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 4 | 0.077 | 0.00 / 0.44 / 0.00 / 0.00 | 0.000 | 1/4 | 0.0000 | 5441 | 856 | 0.000 | 0.000 | 1.00 (1.00) | 0.300 | 4000/4000 exact |
| blocked | 4 | 3.136 | 2.23 / 2.03 / 2.09 / 1.93 | 2.059 | 4/4 | 0.0206 | 4728 | 58701 | -0.022 | 0.000 | 1.06 (1.00) | 0.285 | 4000/4000 exact |

Conduit readouts (late window; the rule the world ran):

| heredity | csat | csatCap | eff p10/p50/p90 | trail per occupied cell p10/p50/p90 | imp layer / non-layer | imp x>=32 / x<32 | connShare / largest | occx (shift) | sensLevel / sensNut | branch births on/off per 1000 particle-steps | branch intake on/off |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 0.000 | 0.000 | 0.0/0.0/0.0 | 0.0/0.0/0.0 | 0.0463 / 0.0000 | - / 0.0000 | 0.106 / 0 | 1.00 (1.00) | 0.0000 / 0.0020 | 1.123 / 1.123 | 2.1332 / 2.1332 |
| blocked | 0.000 | 0.000 | 0.0/0.0/8.0 | 0.0/0.0/2.0 | 0.0292 / 0.0108 | - / 0.0112 | 0.279 / 1 | 1.05 (1.00) | 0.0002 / 0.0018 | 0.268 / 0.277 | 2.2790 / 2.2771 |

### g-base

| heredity | seeds | TM early | TM late (per seed) | TM late med | kept | d late | n late | age late | ALIGN | acute | OCC (occShift) | speed | ledger |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 4 | 0.607 | 1.19 / 0.04 / 0.02 / 0.05 | 0.045 | 1/4 | 0.0004 | 1981 | 1113 | -0.039 | -0.003 | 3.07 (0.55) | 0.266 | 4000/4000 exact |
| blocked | 4 | 5.289 | 3.58 / 3.76 / 3.94 / 3.22 | 3.669 | 4/4 | 0.0368 | 1532 | 60778 | -0.055 | 0.000 | 1.65 (0.95) | 0.291 | 4000/4000 exact |

Conduit readouts (late window; HYPOTHETICAL g=8: what a conduit of that strength would offer on this world's own trail, not a rule the world ran):

| heredity | csat | csatCap | eff p10/p50/p90 | trail per occupied cell p10/p50/p90 | imp layer / non-layer | imp x>=32 / x<32 | connShare / largest | occx (shift) | sensLevel / sensNut | branch births on/off per 1000 particle-steps | branch intake on/off |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 0.000 | 0.000 | 0.0/0.0/0.0 | 0.0/0.0/0.0 | 0.0251 / 0.0000 | - / 0.0000 | 0.399 / 0 | 2.55 (0.59) | 0.0000 / 0.0027 | - | - |
| blocked | 0.000 | 0.000 | 0.0/0.0/0.0 | 0.0/0.0/2.0 | 0.0032 / 0.0006 | - / 0.0007 | 0.355 / 2 | 2.14 (0.92) | 0.0002 / 0.0020 | - | - |

### g-c8

| heredity | seeds | TM early | TM late (per seed) | TM late med | kept | d late | n late | age late | ALIGN | acute | OCC (occShift) | speed | ledger |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 4 | 0.148 | 0.00 / 0.00 / 0.00 / 0.09 | 0.002 | 0/4 | 0.0000 | 2502 | 1540 | -0.000 | -0.000 | 1.70 (0.83) | 0.277 | 4000/4000 exact |
| blocked | 4 | 5.694 | 3.82 / 4.00 / 3.68 / 3.94 | 3.876 | 4/4 | 0.0389 | 1514 | 61089 | -0.055 | 0.000 | 1.60 (0.95) | 0.296 | 4000/4000 exact |

Conduit readouts (late window; the rule the world ran):

| heredity | csat | csatCap | eff p10/p50/p90 | trail per occupied cell p10/p50/p90 | imp layer / non-layer | imp x>=32 / x<32 | connShare / largest | occx (shift) | sensLevel / sensNut | branch births on/off per 1000 particle-steps | branch intake on/off |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 0.000 | 0.000 | 0.0/0.0/0.0 | 0.0/0.0/0.0 | - / 0.0000 | - / 0.0000 | - / 0 | 1.29 (1.00) | 0.0000 / 0.0022 | 0.755 / 0.755 | 2.1770 / 2.1769 |
| blocked | 0.000 | 0.000 | 0.0/0.0/0.0 | 0.0/0.0/2.0 | 0.0034 / 0.0006 | - / 0.0007 | 0.466 / 2 | 2.05 (0.91) | 0.0002 / 0.0020 | 0.429 / 0.431 | 2.4019 / 2.4024 |

### mc12-base

| heredity | seeds | TM early | TM late (per seed) | TM late med | kept | d late | n late | age late | ALIGN | acute | OCC (occShift) | speed | ledger |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 4 | 0.001 | 0.00 / 0.13 / 0.00 / 0.00 | 0.000 | 1/4 | 0.0000 | 5159 | 461 | 0.000 | 0.000 | 1.01 (0.99) | 0.026 | 4000/4000 exact |
| blocked | 4 | 4.417 | 2.16 / 2.30 / 2.14 / 1.96 | 2.146 | 4/4 | 0.0217 | 3183 | 64543 | -0.067 | 0.001 | 1.56 (1.00) | 0.110 | 4000/4000 exact |

Conduit readouts (late window; HYPOTHETICAL g=8: what a conduit of that strength would offer on this world's own trail, not a rule the world ran):

| heredity | csat | csatCap | eff p10/p50/p90 | trail per occupied cell p10/p50/p90 | imp layer / non-layer | imp x>=32 / x<32 | connShare / largest | occx (shift) | sensLevel / sensNut | branch births on/off per 1000 particle-steps | branch intake on/off |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 0.000 | 0.000 | 0.0/0.0/0.0 | 0.0/0.0/0.0 | 0.0105 / 0.0000 | - / 0.0000 | 0.063 / 0 | 1.00 (1.00) | 0.0000 / 0.0037 | - | - |
| blocked | 0.000 | 0.000 | 0.0/0.0/0.0 | 0.0/0.0/1.0 | 0.0196 / 0.0009 | - / 0.0013 | 0.534 / 3 | 1.45 (1.00) | 0.0002 / 0.0027 | - | - |

### toll-ref

| heredity | seeds | TM early | TM late (per seed) | TM late med | kept | d late | n late | age late | ALIGN | acute | OCC (occShift) | speed | ledger |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 4 | 98.661 | 99.36 / 99.91 / 100.39 / 98.63 | 99.637 | 4/4 | 1.0055 | 3887 | 980 | -0.091 | -0.007 | 1.06 (1.00) | 0.588 | 4000/4000 exact |
| blocked | 4 | 74.128 | 94.24 / 94.62 / 93.91 / 94.16 | 94.200 | 4/4 | 0.9510 | 3522 | 44530 | -0.144 | 0.000 | 1.08 (1.00) | 0.296 | 4000/4000 exact |

Conduit readouts (late window; HYPOTHETICAL g=8: what a conduit of that strength would offer on this world's own trail, not a rule the world ran):

| heredity | csat | csatCap | eff p10/p50/p90 | trail per occupied cell p10/p50/p90 | imp layer / non-layer | imp x>=32 / x<32 | connShare / largest | occx (shift) | sensLevel / sensNut | branch births on/off per 1000 particle-steps | branch intake on/off |
|---|---|---|---|---|---|---|---|---|---|---|---|
| inherit | 0.000 | 0.000 | 6.7/10.2/14.7 | 16.1/24.4/34.1 | 0.0335 / 0.0311 | 0.0522 / 0.0301 | 0.997 / 14393 | 1.04 (1.00) | 0.0077 / 0.0021 | - | - |
| blocked | 0.000 | 0.000 | 5.0/8.2/12.7 | 12.6/21.0/31.5 | 0.0709 / 0.0737 | 0.1186 / 0.0684 | 0.991 / 11636 | 1.06 (1.00) | 0.0065 / 0.0020 | - | - |

### Every run (nothing dropped)

| run | world seed | TM late | d late | n late | age late | ALIGN | OCC | impLayer | impNon | birth rel. drop on branch | TM early | ledger |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| base.blind.8101 | 8701 | 98.749 | 0.9966 | 3624 | 295 | 0.001 | 1.53 | 0.1327 | - | - | 98.712 | 1000/1000 |
| base.blind.8102 | 8702 | 98.722 | 0.9968 | 3625 | 294 | -0.001 | 1.52 | 0.1322 | - | - | 98.724 | 1000/1000 |
| base.blind.8103 | 8703 | 98.754 | 0.9966 | 3624 | 293 | 0.001 | 1.53 | 0.1326 | - | - | 98.774 | 1000/1000 |
| base.blind.8104 | 8704 | 98.724 | 0.9966 | 3625 | 294 | -0.000 | 1.52 | 0.1328 | - | - | 98.707 | 1000/1000 |
| base.blocked.8101 | 8301 | 2.011 | 0.0202 | 4712 | 59786 | -0.019 | 1.06 | 0.0013 | 0.0003 | - | 2.737 | 1000/1000 |
| base.blocked.8102 | 8302 | 2.303 | 0.0234 | 4704 | 59154 | -0.020 | 1.05 | 0.0013 | 0.0004 | - | 3.006 | 1000/1000 |
| base.blocked.8103 | 8303 | 2.018 | 0.0205 | 4721 | 60177 | -0.022 | 1.06 | 0.0012 | 0.0003 | - | 3.015 | 1000/1000 |
| base.blocked.8104 | 8304 | 1.900 | 0.0192 | 4717 | 60055 | -0.019 | 1.06 | 0.0011 | 0.0003 | - | 2.786 | 1000/1000 |
| base.inherit.8101 | 8101 | 0.000 | 0.0000 | 4924 | 1399 | 0.000 | 1.00 | - | 0.0000 | - | 0.001 | 1000/1000 |
| base.inherit.8102 | 8102 | 0.002 | 0.0000 | 4843 | 1480 | -0.024 | 1.05 | - | 0.0000 | - | 0.017 | 1000/1000 |
| base.inherit.8103 | 8103 | 0.000 | 0.0000 | 5782 | 413 | -0.003 | 1.01 | - | 0.0000 | - | 0.003 | 1000/1000 |
| base.inherit.8104 | 8104 | 0.000 | 0.0000 | 4800 | 1726 | 0.000 | 1.00 | - | 0.0000 | - | 0.160 | 1000/1000 |
| base.physarum.8101 | 8501 | 98.871 | 0.9981 | 2230 | 522 | 0.992 | 7.73 | -0.0132 | - | - | 98.810 | 1000/1000 |
| base.physarum.8102 | 8502 | 98.852 | 0.9977 | 2257 | 521 | 0.991 | 7.66 | -0.0135 | - | - | 98.885 | 1000/1000 |
| base.physarum.8103 | 8503 | 98.848 | 0.9978 | 2228 | 524 | 0.992 | 7.72 | -0.0131 | - | - | 98.839 | 1000/1000 |
| base.physarum.8104 | 8504 | 98.824 | 0.9978 | 2215 | 525 | 0.992 | 7.77 | -0.0133 | - | - | 98.806 | 1000/1000 |
| c128.blocked.8101 | 8301 | 2.231 | 0.0226 | 4725 | 58617 | -0.022 | 1.07 | 0.0335 | 0.0118 | -0.038 | 3.363 | 1000/1000 |
| c128.blocked.8102 | 8302 | 2.032 | 0.0203 | 4725 | 58791 | -0.022 | 1.07 | 0.0291 | 0.0104 | -0.088 | 2.948 | 1000/1000 |
| c128.blocked.8103 | 8303 | 2.086 | 0.0209 | 4743 | 58519 | -0.022 | 1.06 | 0.0290 | 0.0111 | 0.014 | 3.163 | 1000/1000 |
| c128.blocked.8104 | 8304 | 1.935 | 0.0197 | 4730 | 58786 | -0.019 | 1.06 | 0.0294 | 0.0100 | 0.017 | 3.109 | 1000/1000 |
| c128.inherit.8101 | 8101 | 0.000 | 0.0000 | 4931 | 1333 | 0.000 | 1.00 | - | 0.0000 | 0.000 | 0.001 | 1000/1000 |
| c128.inherit.8102 | 8102 | 0.436 | 0.0044 | 6060 | 379 | -0.011 | 1.05 | 0.0463 | 0.0024 | 0.010 | 0.156 | 1000/1000 |
| c128.inherit.8103 | 8103 | 0.000 | 0.0000 | 5950 | 369 | 0.000 | 1.00 | - | 0.0000 | 0.000 | 0.023 | 1000/1000 |
| c128.inherit.8104 | 8104 | 0.000 | 0.0000 | 4657 | 1668 | 0.000 | 1.00 | - | 0.0000 | 0.000 | 0.131 | 1000/1000 |
| c2.blocked.8101 | 8301 | 2.005 | 0.0203 | 4698 | 59583 | -0.020 | 1.05 | 0.0000 | 0.0000 | -0.000 | 2.799 | 1000/1000 |
| c2.blocked.8102 | 8302 | 2.001 | 0.0203 | 4710 | 59442 | -0.020 | 1.06 | 0.0000 | 0.0000 | -0.005 | 2.981 | 1000/1000 |
| c2.blocked.8103 | 8303 | 1.900 | 0.0192 | 4708 | 58788 | -0.020 | 1.06 | 0.0000 | 0.0000 | 0.005 | 2.730 | 1000/1000 |
| c2.blocked.8104 | 8304 | 2.050 | 0.0207 | 4716 | 59913 | -0.020 | 1.05 | 0.0000 | 0.0000 | 0.000 | 2.847 | 1000/1000 |
| c2.inherit.8101 | 8101 | 0.000 | 0.0000 | 4943 | 1232 | 0.000 | 1.00 | - | 0.0000 | 0.000 | 0.000 | 1000/1000 |
| c2.inherit.8102 | 8102 | 0.189 | 0.0019 | 6037 | 411 | -0.016 | 1.05 | 0.0000 | 0.0000 | -0.000 | 0.094 | 1000/1000 |
| c2.inherit.8103 | 8103 | 0.000 | 0.0000 | 5861 | 372 | -0.007 | 1.05 | - | 0.0000 | 0.000 | 0.020 | 1000/1000 |
| c2.inherit.8104 | 8104 | 0.000 | 0.0000 | 4885 | 2063 | 0.000 | 1.00 | - | 0.0000 | 0.000 | 0.055 | 1000/1000 |
| c32.blocked.8101 | 8301 | 2.223 | 0.0225 | 4722 | 59060 | -0.020 | 1.05 | 0.0081 | 0.0031 | 0.004 | 3.004 | 1000/1000 |
| c32.blocked.8102 | 8302 | 2.035 | 0.0203 | 4692 | 59803 | -0.021 | 1.06 | 0.0077 | 0.0028 | 0.068 | 2.870 | 1000/1000 |
| c32.blocked.8103 | 8303 | 1.861 | 0.0189 | 4717 | 58559 | -0.023 | 1.06 | 0.0073 | 0.0025 | 0.010 | 2.853 | 1000/1000 |
| c32.blocked.8104 | 8304 | 1.984 | 0.0201 | 4717 | 60428 | -0.021 | 1.06 | 0.0074 | 0.0028 | -0.009 | 2.750 | 1000/1000 |
| c32.inherit.8101 | 8101 | 0.000 | 0.0000 | 4941 | 1594 | 0.000 | 1.00 | - | 0.0000 | 0.000 | 0.001 | 1000/1000 |
| c32.inherit.8102 | 8102 | 0.076 | 0.0008 | 5994 | 493 | -0.018 | 1.11 | 0.1155 | 0.0001 | -0.005 | 0.099 | 1000/1000 |
| c32.inherit.8103 | 8103 | 0.000 | 0.0000 | 5601 | 329 | 0.004 | 1.00 | - | 0.0000 | 0.000 | 0.018 | 1000/1000 |
| c32.inherit.8104 | 8104 | 0.000 | 0.0000 | 4704 | 1230 | 0.000 | 1.00 | - | 0.0000 | 0.000 | 0.092 | 1000/1000 |
| c8.blind.8101 | 8701 | 98.735 | 0.9969 | 3664 | 317 | 0.001 | 1.52 | 0.1111 | - | -0.060 | 98.724 | 1000/1000 |
| c8.blind.8102 | 8702 | 98.757 | 0.9969 | 3663 | 318 | 0.000 | 1.53 | 0.1115 | - | -0.082 | 98.706 | 1000/1000 |
| c8.blind.8103 | 8703 | 98.754 | 0.9968 | 3663 | 316 | -0.001 | 1.53 | 0.1115 | - | -0.080 | 98.809 | 1000/1000 |
| c8.blind.8104 | 8704 | 98.761 | 0.9968 | 3663 | 318 | -0.001 | 1.53 | 0.1119 | - | -0.099 | 98.690 | 1000/1000 |
| c8.blocked.8101 | 8301 | 1.881 | 0.0186 | 4706 | 60284 | -0.022 | 1.06 | 0.0012 | 0.0003 | 0.006 | 2.649 | 1000/1000 |
| c8.blocked.8102 | 8302 | 1.982 | 0.0201 | 4709 | 59423 | -0.024 | 1.07 | 0.0013 | 0.0003 | 0.038 | 2.918 | 1000/1000 |
| c8.blocked.8103 | 8303 | 1.935 | 0.0194 | 4716 | 58918 | -0.019 | 1.06 | 0.0012 | 0.0003 | -0.008 | 2.825 | 1000/1000 |
| c8.blocked.8104 | 8304 | 1.837 | 0.0185 | 4700 | 60083 | -0.021 | 1.06 | 0.0011 | 0.0003 | 0.027 | 2.867 | 1000/1000 |
| c8.inherit.8101 | 8101 | 0.000 | 0.0000 | 4939 | 1217 | 0.000 | 1.00 | - | 0.0000 | 0.000 | 0.001 | 1000/1000 |
| c8.inherit.8102 | 8102 | 0.157 | 0.0016 | 6082 | 414 | -0.014 | 1.13 | 0.0013 | 0.0000 | 0.002 | 0.137 | 1000/1000 |
| c8.inherit.8103 | 8103 | 0.000 | 0.0000 | 6003 | 314 | 0.000 | 1.00 | - | 0.0000 | 0.000 | 0.040 | 1000/1000 |
| c8.inherit.8104 | 8104 | 0.000 | 0.0000 | 4633 | 2317 | 0.016 | 1.01 | - | 0.0000 | 0.000 | 0.087 | 1000/1000 |
| c8.physarum.8101 | 8501 | 98.831 | 0.9981 | 2239 | 551 | 0.992 | 7.68 | -0.0120 | - | -0.024 | 98.807 | 1000/1000 |
| c8.physarum.8102 | 8502 | 98.841 | 0.9979 | 2248 | 550 | 0.991 | 7.68 | -0.0133 | - | -0.051 | 98.881 | 1000/1000 |
| c8.physarum.8103 | 8503 | 98.860 | 0.9980 | 2216 | 546 | 0.992 | 7.79 | -0.0131 | - | -0.041 | 98.853 | 1000/1000 |
| c8.physarum.8104 | 8504 | 98.865 | 0.9979 | 2208 | 549 | 0.992 | 7.81 | -0.0123 | - | -0.038 | 98.880 | 1000/1000 |
| diffA104.inherit.8101 | 8101 | 0.000 | 0.0000 | 4985 | 1311 | 0.000 | 1.00 | - | 0.0000 | - | 0.005 | 1000/1000 |
| diffA104.inherit.8102 | 8102 | 0.005 | 0.0000 | 5477 | 4181 | -0.065 | 1.34 | - | 0.0000 | - | 0.072 | 1000/1000 |
| diffA104.inherit.8103 | 8103 | 0.000 | 0.0000 | 6003 | 346 | 0.000 | 1.00 | - | 0.0000 | - | 0.001 | 1000/1000 |
| diffA104.inherit.8104 | 8104 | 0.057 | 0.0006 | 5419 | 3744 | -0.015 | 1.06 | - | 0.0000 | - | 0.086 | 1000/1000 |
| diffA56.inherit.8101 | 8101 | 0.000 | 0.0000 | 4902 | 1711 | 0.000 | 1.00 | - | 0.0000 | - | 0.001 | 1000/1000 |
| diffA56.inherit.8102 | 8102 | 0.082 | 0.0008 | 5029 | 793 | -0.003 | 1.01 | - | 0.0000 | - | 0.036 | 1000/1000 |
| diffA56.inherit.8103 | 8103 | 0.000 | 0.0000 | 5979 | 442 | 0.000 | 1.00 | - | 0.0000 | - | 0.008 | 1000/1000 |
| diffA56.inherit.8104 | 8104 | 0.001 | 0.0000 | 4613 | 3093 | 0.027 | 0.95 | - | 0.0000 | - | 0.063 | 1000/1000 |
| diffA80.inherit.8101 | 8101 | 0.000 | 0.0000 | 4921 | 1605 | 0.000 | 1.00 | - | 0.0000 | - | 0.007 | 1000/1000 |
| diffA80.inherit.8102 | 8102 | 0.004 | 0.0000 | 4863 | 1346 | 0.027 | 1.01 | - | 0.0000 | - | 0.132 | 1000/1000 |
| diffA80.inherit.8103 | 8103 | 0.000 | 0.0000 | 6094 | 428 | 0.000 | 1.00 | - | 0.0000 | - | 0.002 | 1000/1000 |
| diffA80.inherit.8104 | 8104 | 0.004 | 0.0000 | 4856 | 2292 | 0.012 | 1.11 | - | 0.0000 | - | 0.111 | 1000/1000 |
| g-base.blocked.8101 | 8301 | 3.582 | 0.0356 | 1543 | 61504 | -0.052 | 1.67 | 0.0030 | 0.0006 | - | 5.383 | 1000/1000 |
| g-base.blocked.8102 | 8302 | 3.756 | 0.0380 | 1528 | 59847 | -0.053 | 1.63 | 0.0033 | 0.0006 | - | 5.195 | 1000/1000 |
| g-base.blocked.8103 | 8303 | 3.943 | 0.0397 | 1537 | 60052 | -0.057 | 1.79 | 0.0039 | 0.0007 | - | 5.934 | 1000/1000 |
| g-base.blocked.8104 | 8304 | 3.215 | 0.0327 | 1526 | 62572 | -0.061 | 1.60 | 0.0027 | 0.0005 | - | 4.764 | 1000/1000 |
| g-base.inherit.8101 | 8101 | 1.186 | 0.0121 | 1989 | 1075 | -0.039 | 3.27 | 0.0251 | 0.0008 | - | 16.656 | 1000/1000 |
| g-base.inherit.8102 | 8102 | 0.036 | 0.0003 | 1820 | 1150 | -0.039 | 4.43 | - | 0.0000 | - | 0.659 | 1000/1000 |
| g-base.inherit.8103 | 8103 | 0.016 | 0.0002 | 1973 | 399 | -0.063 | 2.86 | - | 0.0000 | - | 0.556 | 1000/1000 |
| g-base.inherit.8104 | 8104 | 0.055 | 0.0005 | 3192 | 2123 | -0.010 | 2.00 | - | 0.0000 | - | 0.127 | 1000/1000 |
| g-c8.blocked.8101 | 8301 | 3.816 | 0.0381 | 1520 | 61996 | -0.056 | 1.56 | 0.0024 | 0.0006 | 0.029 | 5.214 | 1000/1000 |
| g-c8.blocked.8102 | 8302 | 4.002 | 0.0407 | 1503 | 60182 | -0.059 | 1.57 | 0.0033 | 0.0005 | -0.038 | 5.633 | 1000/1000 |
| g-c8.blocked.8103 | 8303 | 3.682 | 0.0373 | 1509 | 59667 | -0.054 | 1.91 | 0.0040 | 0.0008 | 0.031 | 5.756 | 1000/1000 |
| g-c8.blocked.8104 | 8304 | 3.936 | 0.0397 | 1584 | 62679 | -0.053 | 1.64 | 0.0034 | 0.0007 | -0.047 | 5.793 | 1000/1000 |
| g-c8.inherit.8101 | 8101 | 0.000 | 0.0000 | 2100 | 1240 | 0.000 | 1.00 | - | 0.0000 | 0.000 | 0.002 | 1000/1000 |
| g-c8.inherit.8102 | 8102 | 0.004 | 0.0000 | 1707 | 2229 | 0.007 | 2.62 | - | 0.0000 | 0.000 | 0.071 | 1000/1000 |
| g-c8.inherit.8103 | 8103 | 0.000 | 0.0000 | 3865 | 331 | -0.000 | 1.00 | - | 0.0000 | 0.000 | 0.225 | 1000/1000 |
| g-c8.inherit.8104 | 8104 | 0.093 | 0.0010 | 2905 | 1840 | -0.005 | 2.40 | - | 0.0000 | -0.018 | 0.363 | 1000/1000 |
| mc12-base.blocked.8101 | 8301 | 2.157 | 0.0218 | 3203 | 64336 | -0.067 | 1.57 | 0.0198 | 0.0009 | - | 3.828 | 1000/1000 |
| mc12-base.blocked.8102 | 8302 | 2.301 | 0.0234 | 3170 | 64616 | -0.065 | 1.53 | 0.0193 | 0.0010 | - | 4.703 | 1000/1000 |
| mc12-base.blocked.8103 | 8303 | 2.136 | 0.0215 | 3172 | 64824 | -0.067 | 1.60 | 0.0215 | 0.0009 | - | 4.849 | 1000/1000 |
| mc12-base.blocked.8104 | 8304 | 1.964 | 0.0200 | 3194 | 64470 | -0.066 | 1.55 | 0.0177 | 0.0008 | - | 4.131 | 1000/1000 |
| mc12-base.inherit.8101 | 8101 | 0.000 | 0.0000 | 5206 | 472 | 0.000 | 1.00 | - | 0.0000 | - | 0.000 | 1000/1000 |
| mc12-base.inherit.8102 | 8102 | 0.131 | 0.0013 | 5199 | 450 | -0.052 | 1.73 | 0.0105 | 0.0000 | - | 0.192 | 1000/1000 |
| mc12-base.inherit.8103 | 8103 | 0.000 | 0.0000 | 5094 | 520 | 0.000 | 1.00 | - | 0.0000 | - | 0.001 | 1000/1000 |
| mc12-base.inherit.8104 | 8104 | 0.000 | 0.0000 | 5119 | 446 | 0.009 | 1.02 | - | 0.0000 | - | 0.001 | 1000/1000 |
| toll-ref.blocked.8101 | 8301 | 94.243 | 0.9514 | 3518 | 44671 | -0.142 | 1.08 | 0.0708 | 0.0729 | - | 73.356 | 1000/1000 |
| toll-ref.blocked.8102 | 8302 | 94.623 | 0.9559 | 3530 | 44126 | -0.144 | 1.08 | 0.0709 | 0.0719 | - | 75.567 | 1000/1000 |
| toll-ref.blocked.8103 | 8303 | 93.909 | 0.9490 | 3519 | 45225 | -0.146 | 1.08 | 0.0716 | 0.0751 | - | 74.305 | 1000/1000 |
| toll-ref.blocked.8104 | 8304 | 94.158 | 0.9506 | 3526 | 44389 | -0.144 | 1.08 | 0.0707 | 0.0746 | - | 73.951 | 1000/1000 |
| toll-ref.inherit.8101 | 8101 | 99.359 | 1.0025 | 4216 | 207 | -0.056 | 1.07 | 0.0425 | - | - | 98.529 | 1000/1000 |
| toll-ref.inherit.8102 | 8102 | 99.914 | 1.0086 | 3929 | 762 | -0.154 | 1.05 | 0.0488 | - | - | 108.148 | 1000/1000 |
| toll-ref.inherit.8103 | 8103 | 100.394 | 1.0135 | 3846 | 1198 | -0.103 | 1.04 | 0.0244 | - | - | 98.628 | 1000/1000 |
| toll-ref.inherit.8104 | 8104 | 98.628 | 0.9956 | 3785 | 4335 | -0.079 | 1.08 | 0.0241 | 0.0311 | - | 98.694 | 1000/1000 |


## Note 15 Nov 2026: label rules under unit test

The section 7 rules moved to `tools/mycelium/conduit-labels.ts` (re-exported by `conduit-screen.ts`) and have unit tests in `tools/test/mycelium-conduit-labels.test.ts`. A Sol 6.1 High review of the move found one rule bug from before it: a blocked partner with no sensitivity readout counted as zero, so route H(ii) could pass on a missing value. The rule now fails a missing value, as section 7 says. Re-running `conduit-screen.ts --label` on the 200 finished runs gives byte-identical output before and after (every strength is PURGED on K alone), so no recorded label changes.
