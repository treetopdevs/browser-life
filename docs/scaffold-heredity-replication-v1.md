# Scaffold heredity replication: protocol v1 (sandbox, fixed before any data)

*2026-09-30. Opened by the user's decision after the R1′ result in `docs/scaffold-protocol-v1.md`. It tests one question on fresh histories, with a design fixed before any of its data exist. The line is still exploratory and not registered, does not answer the reset line's entity question, and does not count toward M6. After the first fresh run starts, any change to this document goes in a dated amendment at the end.*

## Question

Is pond-level heredity demonstrable under the scaffold (`scaf`) when it is measured by a discretised, capped crossing-time score instead of a mass at a fixed time? That score avoids the end-mass ceiling that limited R1 and R1′, but it can still compress at its two endpoints.

R1 (end trait at boundary 100) and R1′ (trait at τ = 4,100 at boundary 34) both ran at high saturation: 95–100% of surviving `scaf` fragments were at the assay ceiling. Neither design could establish or rule out heredity.

**What the earlier histories informed.** They informed the choices below: boundary 34, a time-to-mass trait, and m*. None of the data this protocol analyses exists yet.

## Fresh histories

- **The regime is protocol v1's frozen main configuration** (`experiments/scaffold/main-config-v1.json`): 64 ponds, ancestor `M3_FOUNDERS[2]`, k 8, period 10,000, D 16, default mutation rate, census every 100 steps. The tools are at the current `sandbox/scaffold`. `tools/scaffold.ts` and `tools/lib/ponds.ts` are unchanged since the main run.
- **Arms:** `scaf` and `rand`, 6 histories each. They run 34 cycles: `--cycles 34`, so the pre-cycle state at boundary 34 is the final-boundary checkpoint `b34-pre`.
- **Seeds:** 4,811,001 + 100·arm + i, where arm 0 is `scaf`, arm 1 is `rand`, and i runs 0–5. Every seed is checked to be unused by earlier work in the 4,800,001–4,849,999 block.
- A history that goes extinct before boundary 34 has no `b34-pre`. It is valid only for the extinction count, and it counts as not demonstrated.

## Trait R1″: crossing time (a discretised, capped score)

R1″ uses the standardised transmission assay exactly as R1 and R1′ do:
- donors are the 16 eligible ponds with the smallest purpose-1 donor key;
- 64 fragments per replicate, fragment f from donor f mod n;
- two replicates, mutation off, one period;
- assay matter budget 151,552;
- trait recorded at every census (`--traits`).

**Per fragment:**
- **T** is the first census step (100, 200, …, 10,000) at which the fragment's pond trait reaches m* = 25,764.5. That is 0.25 · ref, the threshold that defined τ.
- A fragment that never reaches m* within the period, dead or alive, gets T = 10,100 (censored).
- **The trait is log T.**

**Limitation.** The score avoids the end-mass ceiling, but it can still pile up at T = 100 (crossed by the first census) or at T = 10,100 (never crossed). Both endpoint fractions are reported for every set. A negative conclusion carries this limitation.

**Statistic.** As R1:
- OLS of log T on log1p(retained B+P) and log1p(retained E), fitted over all 128 fragments of the set;
- the ICC(1) of the residuals, with families = donors and replicates pooled;
- the p-value from 1,000 Fisher–Yates permutations of family labels, keeping family sizes, with p = (1 + #) / 1001.

**Null and assumption.** The null hypothesis is that, after the OLS adjustment, fragments are exchangeable across donor families. That means donor identity carries no information about the adjusted score, pooled over both replicates. Ties and the censored mass point do not invalidate the permutation test, but exchangeability is an assumption: the OLS adjustment need not remove every family-level difference in retained mass or energy. It is therefore checked empirically with the null-calibration gate below (Winkler et al. 2014).

## Controls (measure validation, run first)

- **Positive control.** The P2 ranking worlds at boundary 1 (`runs/scaffold/p2/rank/s0` and `s1`, `ckpt/b1-pre.blck.gz`): 12 founders round-robin, mutation off, one period. Its donor ponds differ genetically by construction.
  - The measure is valid only if the positive control's ICC is above 0 with p < 0.05 in both worlds.
  - If it fails, R1″ is uninformative, and the line stops here.
- **Negative controls (the null-calibration gate).** Four genetically clonal worlds, newly grown for this protocol. Each runs `evolve --arm cont --init clone --mut-off --cycles 1 --side 8` with seed 4,811,201 + j, j = 0–3, so its donors share the ancestor genome exactly. Each is assayed at its `b1-pre`.
  - **Gate:** at most 1 of the 4 negative controls may have p < 0.05.
  - If 2 or more are significant, the test cannot be told apart from its null-control behaviour, and R1″ is uninformative.
- **Wording of a positive result.** A positive R1″ is always described as heritable "genetic or structural" variation among donor ponds. A non-significant negative control does not establish genetic causation.

## Seeds for the assays

- Assay seed = 4,812,001 + 250·h + s. There is one time (boundary 34), so the 100·t term of the earlier blocks is dropped.
- h = 6·arm + i for the fresh histories (0–11).
- Controls take h = 12 (positive, s0 world), 13 (positive, s1 world) and 14–17 (negatives j = 0–3).
- s = 0–1 are the replicates, s = 8 the permutation stream and s = 9 the donor selection. The block's maximum is 4,816,260.
- The negative-control worlds use 4,811,201–4,811,204.
- **Code to build before any assay:**
  - assay labels and seed validation for this block (`r1dprime`, h 0–17, with the control identities);
  - provenance recording of the source checkpoint path and the protocol's SHA-256;
  - a report stage that, from complete `traits.tsv` files, extracts first crossings, applies log, OLS and ICC with the permutation test, evaluates the controls, and evaluates availability.

  Production assays never use `--allow-any-seed`. The protocol and the implementation are committed, and their hashes recorded, before the first control assay.

## Rule (fixed now)

Applied in this order:

1. **Controls.**
   - The positive control must pass in both worlds.
   - The null-calibration gate must hold: at most 1 of 4 negative controls significant.
   - Otherwise R1″ is uninformative.
2. **Availability.**
   - **Technically available:** a fresh history is technically available at boundary 34 when its `b34-pre` exists, its assay is complete (`assay.json`, plus `assay.tsv` and `traits.tsv` with the full 2 × 64 grid at every census), and its analysis completes.
   - **Retry:** a failed or incomplete assay is rerun once with the same seeds. If it still fails, the history is technically unavailable.
   - **Extinction:** a history that goes extinct before boundary 34, or has fewer than 2 eligible donors, is a biological outcome. It is valid, and not demonstrated.
   - If fewer than 4 `scaf` histories are valid, R1″ is uninformative.
3. **Rule.** R1″ is demonstrated in `scaf` if, at boundary 34, ICC > 0 with p < 0.05 in at least 4 of 6 fresh `scaf` histories. Technically unavailable histories count as not demonstrated.
3. **Reported for `rand`, with the same statistic.**
4. **Descriptive, never decision inputs:**
   - each set's fractions at T = 100 and at T = 10,100;
   - the end trait, and the trait at τ = 4,100, at boundary 34;
   - the between-family variance component;
   - the extinction counts.

## Disposition

- **R1″ demonstrated in `scaf`.** Pond-level heredity under the scaffold is demonstrated on fresh histories by a design fixed in advance.
  - Protocol v1's row 3 is superseded, and its recommendation (a heredity rule variant) is withdrawn.
  - Re-entering the v1 table with R1″ in place of R1, R2 and R3 as recorded, would reach row 6. But R3 passed only at its threshold, on the earlier histories.
  - So the next step is a separate dated decision between integration (B) and an R3 replication on these fresh histories. R3 replication would precede any registration (C).
- **R1″ not demonstrated in `scaf`, with the measure valid.**
  - Pond-level heredity under the scaffold is not demonstrated by the capped crossing-time score. That score avoids the end-mass ceiling, but it can still compress at T = 100 and T = 10,100; both fractions are reported, and the conclusion carries that limitation.
  - Row 3 and its recommendation (a heredity rule variant, by separate dated decision) stand. They now rest on a design that avoids the end-mass ceiling, with the endpoint-compression limitation.
- **Uninformative.** A control gate fails, or fewer than 4 `scaf` histories are valid. Report it and stop.
- **Earlier results.** Whatever the outcome, R1's and R1′'s results stay recorded as they are in `docs/scaffold-protocol-v1.md`.

## Compute and budget

- **Total:** about 4.5 × 10⁶ 512² steps on the Mac, at $0:
  - 12 fresh histories × 340,000 steps;
  - 4 negative-control worlds × 10,000 steps;
  - 18 assays × 20,000 steps.
- No AWS.

## Results (2026-10-01)

**Run and provenance.**
- All 12 fresh histories completed 34 cycles with exact conservation, and none ended early.
- All 18 assays (6 controls and 12 histories) completed on their first attempt.
- Order of events: the protocol was committed (ce13b0cb) before any world started, and the code was committed (90577bad) before any assay.
- Every number was re-derived independently from the raw files, with the protocol's permutation stream, and no number was disputed. Provenance checks (seeds, donor selection, source step and phase, mutation rates, genome counts) all pass.
- Readout: `experiments/scaffold/readouts/r1dprime.json`.

**Controls (gate 1): both pass.**
- Positive (founder worlds): ICC 0.939 and 0.754, both p = 0.001.
- Null gate: 0 of 4 mutation-off clone worlds were significant (p 0.853, 0.691, 0.076, 0.738). The gate allows 1.

**Availability (gate 2).** 6 of 6 `scaf` histories are valid.

**Rule: R1″ is demonstrated in `scaf`, in 6 of 6 histories** (the rule needs 4). Each history's ICC with its p:

| History | ICC | p |
|---|---|---|
| i0 | 0.093 | 0.036 |
| i1 | 0.213 | 0.003 |
| i2 | 0.161 | 0.003 |
| i3 | 0.216 | 0.001 |
| i4 | 0.397 | 0.001 |
| i5 | 0.585 | 0.001 |

**Disposition.** Pond-level heredity under the scaffold is demonstrated on fresh histories, by a design fixed in advance, as heritable genetic or structural variation among donor ponds.
- Protocol v1's row 3 is superseded, and its recommendation (a heredity rule variant) is withdrawn.
- The next step is a separate dated decision between integration (B) and an R3 replication on these fresh histories. The R3 replication would come before any registration (C).
- R1's and R1′'s results stay recorded as they are.

**Descriptive (not decision inputs).**
- `rand` was demonstrated in 6 of 6 too, with ICC 0.26–0.78.
- Fractions at T = 100 were 0 in every set.
- Censored fractions (T = 10,100):
  - `scaf` 3.9–19.5%;
  - `rand` 1.6–94.5%;
  - positive controls 74–81%;
  - negative controls 4.7–8.6%.
- On the same assays, the end trait detects heredity in 0 of 6 `scaf` histories, and the trait at τ = 4,100 in 1 of 6.

**Caveats, from the independent re-derivation.**
- **Survives:** the result holds on survivors only, with T replaced by its rank, with cubic covariates, with thresholds of 0.15, 0.35 and 0.5 × ref, and with any one history dropped. None of these raised false positives in the negative controls beyond 1 of 4.
- **Fragile:**
  - Without the OLS covariates, 3 of 6 pass; the censored mass point dominates the raw variance.
  - Each replicate alone gives 3 of 6 and 5 of 6.
  - In i0, i2 and i3 the signal rests on a few donor families: the worst leave-one-family-out gives 3 of 6. The influential family deviates in the same direction in both independent replicates.
  - i0 is borderline: p = 0.036, and 0.0395 at 50,000 permutations.
- **Scope:**
  - This shows that heredity is present under the scaffold. It does not show that the scaffold causes or increases it: `rand` has equal or larger ICCs.
  - The negative controls have gentler covariate slopes and larger packets than the evolved `scaf` sets, so the null calibration does not cover that regime fully.
