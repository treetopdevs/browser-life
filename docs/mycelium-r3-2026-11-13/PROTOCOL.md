# Mycelium world, rung R3: is the missing trail purged by selection? (protocol, 13 Nov 2026)

Status: written before any new run. Everything is local and uncommitted, run on native WebGPU on one Mac. The `/mycelium/` page is not touched. Rule id `mycelium-r0`; the kernel (`tools/mycelium/world.ts`, `gpu.ts`) is byte-identical to the one R2b froze (section 9 checks this).

## 1. The question and why it is directional

R2b (measurement-limited, `docs/mycelium-r2b-2026-11-13/RESULT.md`) saw, descriptively, that in the **inherit** arm trail laying mostly disappears by step 50,000 (13 of 20 dev seeds with trail mass per particle under 0.01), while every **blocked** seed (a new random controller at each birth) keeps 1.8 to 2.4 units of trail per particle. R2b's rules could not use that contrast. R3 asks one thing about it:

> **Hypothesis H (purge).** In the inherit arm, selection removes trail laying because laying trail costs energy and body matter. Heredity lets lineages that lay less out-reproduce those that lay more; the blocked arm, whose children are always fresh random controllers, cannot.

R3 does not test heredity against a trail-following null, structure, individuality or open-endedness. It tests the direction of one mechanism with readouts that exist at zero trail, and it writes down what would contradict H.

Why "blocked is lower in trail" is not already the answer. Blocked is a random-controller baseline, not "inherit minus heredity": its particles are very old (median age about 60,000 steps against 200 to 4,600 for inherit in R2b's dev data), so the blocked population is also filtered, only by survival, never by lineage. A difference between the two arms can therefore come from several things: heredity selecting on deposit (H), mutation drifting controllers away from the founder distribution, or the different age structure. The discriminators below are chosen so that each of those alternatives predicts something different from H. Nothing below is shown by a single contrast.

## 2. Arms, slots and seeds

All arms are `defaultConfig()` (128 x 128, 1,024 founders, cap 8,192) plus the delta in the table. Only existing config keys are used and `defaultConfig()` is unchanged, so every earlier digest and pin is untouched.

| arm | delta | role |
|---|---|---|
| inherit | none (depositCost 2) | the world as it is |
| blocked | `heredity: "blocked"` | random-controller baseline at cost 2 |
| frozen | `heredity: "frozen"` | exact copies, no mutation: only the 1,024 founders compete (D4) |
| inherit-c1, inherit-c4 | `depositCost` 1, 4 | dose arms (D3) |
| blocked-c1, blocked-c4 | `heredity: "blocked"`, `depositCost` 1, 4 | the mechanical baseline of each cost |

**There is no zero-cost arm.** `depositCost` has a minimum of 1 (`validateConfig`), and a deposit also takes matter out of the body (`world.ts`, phase 5: `dep = min(maxDeposit x relu(DEPOSIT) >> 7, M)`, then reduced to what the energy pays at `depositCost` per unit), so even at cost 1 trail laying is not free. The trail also returns as waste and then nutrient (the field phase), so it is not pure loss either. The dose arms therefore vary the cost between 1, 2 and 4; they do not remove it, and D3 is a trend, not a "cost off" contrast.

**Slots and world seeds.** A *slot* is the registered label of a run. The world seed in the config is `slot + offset(arm)`, with offsets 60,000 (inherit), 70,000 (blocked), 80,000 (frozen), 90,000 (inherit-c1), 100,000 (inherit-c4), 110,000 (blocked-c1), 120,000 (blocked-c4) (`tools/mycelium/r3-seeds.ts`). So no two arms share founders or a PRNG stream.

- **Dev** (generated or sharpened the design; never part of the label): slots 2001-2010 for frozen and the four cost arms, run by R3 under the frozen code (50 runs). For inherit and blocked at the default cost, R3 reads R2b's dev series on slots 2001-2020 (world seeds 2001-2020 and 12001-12020), read only. R2b's 2001-2020 generated H, so they are dev data. They carry R2b's code hash; R3 accepts them by their `fileSha256` in R2b's own seed log, by their R2b config, and by the kernel files being identical (section 9).
- **Confirmation:** slots **6001-6016**, all seven arms, 100,000 steps (112 runs). Never run before this protocol.
- **R2b's embargoed confirmation slots 5001-5016 stay embargoed and unused.** **Slots 8001-8099 are not R3's** (another exploration's); R3 never runs or reads them. The run gate refuses both.
- Every R3 world seed is 60,000 or more, so `run.ts` (seeds below 9001 only) and `r2.ts` (its confirm gate takes 9001-9005 only) already refuse them. Both files are in R2's frozen manifest, so they are not edited for this; `tools/test/mycelium-r3.test.ts` checks the refusal against their own gate functions. R3 worlds run only through `tools/mycelium/r3.ts`, which logs them.

## 3. Runs

100,000 steps per run on the GPU (`GpuMycelium`), 128 x 128 as R2b. Scalar census every 100 steps (ledger check: matter and energy residual exactly 0 and `validateState`, at every one of the 1,000 censuses; any nonzero residual makes the run invalid and stops the protocol), heavy census every 500 (the deposit measure d). The census series are the same `R2bObserver` series as R2b's, so R2b's dev files and R3's are read by one function. One CPU digest cross-check of one finished dev run (before calibration) and one finished confirmation run (before the label) at the full 100,000 steps (`r3.ts cpu-check`), logged, is an acceptance gate: calibration is not READY without the dev check and the confirmation analysis is INVALID without the confirmation check, each requiring equal digests, the run file's digest and the frozen code hash. A batch or cpu-check takes an exclusive lock beside the canonical seed log (`seed-log.jsonl.lock`, whatever `--out` root is used) and the seed log refuses a second finished entry for a run or a finished entry with no started entry, so a run is never repeated. Confirmation runs are batch-only, print digests only, and are never repeated.

## 4. Readouts (all defined at zero trail)

For a run, two windows: **E = (0, 5,000]** and **L = (50,000, 100,000]**.

- **d**: the mean over the window's heavy censuses of the deposit measure d (matter the live particles would deposit in the next step, per particle, with decay off; `observe-r2b.ts`). Defined with no trail at all and with no particles (0). `dE`, `dL`.
- **TM**: the mean over the window's scalar censuses of (sum of trail) / n (a census with n = 0 counts 0). `tmE`, `tmL`.
- **g = (dL - dE) / (dL + dE)**, in [-1, 1], with 0/0 := -1 (no deposit in either window: deposit is gone however early it vanished; this is the limit of the formula along dL = 0, where any positive dE gives -1, so a purge that finishes before the first heavy census at step 500 cannot read as "no change" and cannot contradict H). Bounded and defined at zero; absolute change is not used (it is dominated by how much trail the arm started with).

No mass cutoff, no log of a possibly zero value, no Moran's I, no classifier. Every readout is a deterministic function of the stored census series; the analysis recomputes each from the series and refuses a run file whose stored readout differs.

**Why these windows.** L is R2b's frozen window, so the late contrast is a literal replication. E starts at step 0 because H is about the trajectory from the random founders, whose deposit is by construction that of the blocked baseline, and ends at 5,000, the first tenth of the run, by which point the population has grown from 1,024 founders to about its level and a few generations have turned over. Disclosure: this choice was made after looking at R2b's dev series (inherit's deposit and its ratio to blocked's, by step), which is dev data; an earlier draft used (5,000, 25,000], which those series showed starts after most of the divergence. Nothing from slots 6001-6016 exists.

## 5. Discriminators, with the direction predicted in advance

Two-sided tests are used, so the sign of the effect, not an assumption, decides support or contradiction.

- **D1, replication.** Predicted: inherit's late deposit rate is below blocked's at the default cost. Statistic: Mann-Whitney on `dL`, inherit against blocked (n = 16 and 16); effect = minus Cliff's delta (positive supports H).
- **D2, within-run decline.** Predicted: inherit's g is more negative than blocked's (inherit's deposit falls more, relatively, from E to L). Statistic: Mann-Whitney on g; effect = minus Cliff's delta. Blocked's g is also negative (blocked loses deposit through survivor filtering); H predicts a larger fall in inherit.
- **D3, dose response.** For each cost c in {1, 2, 4}, each inherit-family run gets the score `z = dE(inherit at cost c, slot s) / dE(blocked at cost c, same slot s)`: the blocked arm at the same cost is the mechanical baseline (it carries whatever cost does to deposit without lineage selection). The two runs of a pair are independent worlds, so the scores are independent across runs and, under "the ratio distribution does not depend on the cost", exchangeable across costs; this is what the permutation test needs. (A first draft divided by the blocked arm's mean at each cost; Sol showed that a shared estimated baseline makes the scores of a cost dependent and the permutation null invalid, so the pairing replaced it. The pairing by slot number is arbitrary and fixed here; blocked's early deposit varies by a few percent between worlds, so the pairing adds little noise.) Predicted: z falls as the cost rises. Statistic: the Jonckheere-Terpstra tau (the mean over the three cost pairs of Cliff's delta of the lower-cost group against the higher-cost group; +1 means every lower-cost score is above every higher-cost score), two-sided p by 1,000,000 fixed-key permutations of the pooled 48 scores over the three group sizes. The window is E because inherit's late deposit is at or near zero at every cost (a floor that cannot fall further): a late-window dose response could not be seen, and a floor tie there is not evidence either way. A slot present in only one arm of a pair is not scored; a paired blocked early deposit of 0 makes D3 undefined (NULL).
- **D4, frozen arm (descriptive, never part of the label).** Predicted: **FROZEN-LOW**, that is, frozen's late deposit is below blocked's with Cliff's delta <= -0.5 and a raw two-sided Mann-Whitney p < 0.05. Reasoning: the frozen arm has no mutation, so only the 1,024 random founders compete; if some founders lay less (they are random controllers, so they differ), selection among them alone should already remove trail laying. Reading (written now; the code prints exactly one of these five). Precedence: a purge must exist before anything is explained. "Purge" here means inherit's late deposit is below blocked's with Cliff's delta <= -0.5 and a raw two-sided p < 0.05; "frozen low" is the FROZEN-LOW condition above; "inherit below frozen" is the same condition for inherit against frozen (delta <= -0.5 and p < 0.05).
  - **NO-PURGE** (no purge): nothing to explain, whatever frozen did. (A frozen arm that sits above inherit while inherit is not below blocked says nothing about mutation.)
  - **FROZEN-SUFFICES** (purge, frozen low, inherit not below frozen): selection on the standing founder variation is enough to account for the low deposit; mutation is not needed for it.
  - **FROZEN-PLUS-MUTATION** (purge, frozen low, inherit below frozen): selection on standing variation does part of it and mutation-supplied variation adds more.
  - **MUTATION-NEEDED** (purge, frozen not low, inherit below frozen): the founders alone do not account for the low deposit and the arm with mutation is lower than the arm without it, so new variants matter. This is the only reading that says mutation is needed.
  - **UNRESOLVED** (purge, frozen not low, inherit not below frozen): frozen missed the floor and the direct comparison did not separate inherit from frozen (frozen at delta -0.49 and inherit at -0.51 are not different from each other). Nothing is said about whether mutation is needed.

  **Why drift alone is not expected to explain inherit < blocked.** With selection absent, mutation moves lineages by a random walk (each child, with probability mutRate/65,536, changes `mutCount` = 2 weights by up to +-16, clamped at +-127), so lineages spread out from the founder distribution that blocked redraws at every birth; drift would be expected to pull inherit toward the blocked baseline, not below it. This is an expectation, not a proof: the walk spreads weights toward the clamp and could shift the typical DEPOSIT output in either direction, which is why D2 and D3 exist and why the label never rests on D1.
- **C1, trail-mass concordance.** Cliff's delta of `tmL`, inherit against blocked, must be <= -0.33 for a PASS (the stock readout agrees with the flow readout). It never turns a result into a FAIL.

## 6. The label

**Tests.** D1, D2 and D3 are the family: one Holm adjustment of their three two-sided p-values at alpha = 0.05. A test **SUPPORTS** H when its Holm test rejects and its effect (positive = supports) is at least the floor (**0.5** for D1 and D2, **0.25** for D3); it **CONTRADICTS** H when it rejects and the effect is at most minus the floor; otherwise it is **NULL**. The Mann-Whitney p is exact without ties and a fixed-key permutation Monte Carlo (1,000,000) with ties (`r2b-stats.ts`). A group with fewer than 3 runs makes its test NULL.

- **PASS (purge supported):** D1, D2 and D3 all SUPPORT, and C1 holds.
- **FAIL (directionally contradicted):** at least one of D1, D2, D3 CONTRADICTS. A mixed result (one supports, one contradicts) is a FAIL; the report says which.
- **INCONCLUSIVE:** everything else, including a floor tie (no variation to read), an underpowered test, or a supported D1 and D2 without a supported D3. INCONCLUSIVE is not FAIL and not weak PASS.
- **INVALID** (an integrity failure, not a scientific label): any ledger residual, a run file that does not match its seed-log hash, readouts or config that do not recompute, a code hash other than the frozen one, a missing run, a log with a leak or an invalid entry, or a calibration that is not READY.

**Population guard.** A run with n < 200 at any scalar census of E or L is flagged. It is kept in every test (nothing is excluded on an outcome). The label is also computed without the flagged runs; if the two labels differ the label is INCONCLUSIVE.

**What each label means.** PASS: in this world, the inherit arm's low trail is more than a difference from a random baseline: it replicates, it shows a larger relative decline, and it deepens with the cost of laying, which is what selection against a costly trait predicts and what a pure baseline difference does not. It is not a demonstration of the mechanism (no lineage-level selection coefficient is measured; section 10). FAIL: H is directionally contradicted. INCONCLUSIVE: nothing more than the descriptive contrast can be said.

## 7. Integrity gates (all of them)

Ledger residual 0 at every census; population guard (section 6); provenance (section 9). No readout is gated on a positive control (R2b: no control moved TM significantly), and no trail readout is dropped for failing to separate.

## 8. Calibration and attainability (before confirmation)

After the 50 R3 dev runs, `r3-analyze.ts calibrate` writes `CALIBRATION.json`. Both earlier rungs died here on an unreachable gate, so the gate is only attainability, applied to the decision code, with every number below fixed now:

- **PASS reachable:** datasets of 16 runs per arm are resampled (fixed keys, 100 replicates) from R2b's dev inherit and blocked pools, with a dose response planted (inherit's early deposit multiplied by `f` at cost 1 and divided by `f` at cost 4, the blocked arm drifting 1.2x at cost 1 and 0.7x at cost 4). READY needs **at least 80% PASS at f = 4**; rates at f = 1.5, 2 and 3 are reported as the detectable effect, not gated.
- **FAIL reachable:** the dev data with inherit and blocked swapped at every cost must give FAIL.
- **Null:** inherit and blocked readouts pooled and dealt back at random at each cost (100 deals): PASS at most 5% and FAIL at most 12% (the nominal FAIL rate is at most 5%; the limit leaves room for the Monte Carlo of 100 deals).
- **Integrity:** the 50 dev runs and the 40 reused R2b runs pass the checks of section 7 (the R2b files by R2b's seed-log hashes), and the dev CPU cross-check passed.
- The rules are also applied to the real dev data and the label and numbers are reported, **not gated** (dev sample sizes are 20 + 20 at the default cost and 10 per other arm).

If calibration is not READY the protocol stops (MEASUREMENT-LIMITED) and confirmation is not run.

## 9. Freeze, provenance and amendments

`FROZEN` records, before any new dev run (Freeze 1): the SHA-256 of this file, `code_hash` (SHA-256 of a manifest over the import closure of `r3.ts`, `r3-analyze.ts` and `r3-freeze.ts` under `tools/mycelium`, which includes `world.ts`, `gpu.ts`, `observe-r2b.ts`, the R2b modules they import and this protocol's modules, plus `RULES.md`, `packages/schema/src`, `packages/sim-ref/src` and `deno.json`) and a per-file hash line for each. After calibration and before the first confirmation run (Freeze 2) one line appends `calibration_sha256`. The runner and the analysis verify both. The kernel check: `world.ts` and `gpu.ts` must hash to the lines of `docs/mycelium-r2b-2026-11-13/FROZEN` (`04c00090...` and `c81c84c8...`). The R2b dev files' seed-log hashes are checked against R2b's log. `r2b-decide.ts` is not called (it carries an open Sol P1 about mass-filtered Moran's I, which R3 does not use).

Any change to a hashed file or this protocol after Freeze 1 is a dated `## Amendment` below, with a reason that cites no confirmation result (none exists), a new Freeze 1, and a re-run of every dev run it affects. At most two amendments before the first confirmation run.

## 10. What a PASS would and would not show; limits

- Not a demonstration of selection: no per-lineage fitness or selection coefficient is measured. The tests are directional implications of H and of its competitors (section 1).
- The calibration planting multiplies whole arms by constants, so it shows that the rules and the code can reach PASS and FAIL and at roughly what multiplicative dose effect (a rough power), not that a real dose trajectory will be detected.
- The cost arms are 1, 2, 4, never 0; a purge that is already complete at cost 1 shows no dose response (INCONCLUSIVE by design).
- Blocked at each cost is only a mechanical baseline for D3; survivor filtering in blocked is part of why its deposit falls over time.
- A single world (128 x 128, uniform light, default rules, 100,000 steps); nothing about other rules or horizons.
- Per-census values come from stored series, not raw fields or genomes (not stored).

## 11. Review and analysis

A Codex Sol 6.1 High read-only review of this protocol, the runner and the decision code precedes Freeze 1 (a fix to a hashed file afterwards costs the dev runs). A second analysis recomputes every readout from the raw series in separate Python and compares. A final Sol review of the diff closes the rung. Sol's text is kept in the session scratchpad; the dispositions are in `RESULT.md`.

## Amendments

(none)
